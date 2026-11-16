package fetch_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/fetch/fetchtest"
	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

const token = "ghp_spec-token-never-written"

var (
	base      = time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	walkStart = time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
)

func at(hours int) time.Time { return base.Add(time.Duration(hours) * time.Hour) }

func user(login string) *fetch.Actor { return &fetch.Actor{Login: login, Typename: "User"} }

func pr(number, updated int, state string) fetch.Entry {
	e := fetch.Entry{
		Number: number, Title: "pr " + strconv.Itoa(number), Body: "body", State: state,
		CreatedAt: at(-100), UpdatedAt: at(updated), BaseRefName: "main",
		Additions: 3, Deletions: 1, ChangedFiles: 2, AuthorAssociation: "MEMBER",
		Author: user("alice"),
	}
	if state != "OPEN" {
		e.ClosedAt = new(at(updated))
	}
	return e
}

func commits(n int) []fetch.Commit {
	out := make([]fetch.Commit, n)
	for i := range out {
		out[i] = fetch.Commit{AuthoredDate: at(-90 + i), CommittedDate: at(-80 + i), Message: fmt.Sprintf("commit %d", i)}
	}
	return out
}

func comments(n int) []fetch.Comment {
	out := make([]fetch.Comment, n)
	for i := range out {
		out[i] = fetch.Comment{CreatedAt: at(-70 + i), Body: fmt.Sprintf("comment %d", i), Author: user("bob")}
	}
	return out
}

func reviews(n int) []fetch.Review {
	out := make([]fetch.Review, n)
	for i := range out {
		out[i] = fetch.Review{SubmittedAt: new(at(-60 + i)), State: "COMMENTED", Author: user("carol")}
	}
	return out
}

var _ = Describe("Run", func() {
	var (
		cacheDir string
		server   *fetchtest.Server
		pageSize int
		waits    []int
		logs     *bytes.Buffer
	)

	BeforeEach(func() {
		cacheDir = GinkgoT().TempDir()
		pageSize = 0
		waits = nil
		logs = &bytes.Buffer{}
	})

	serve := func(prs ...fetch.Entry) {
		server = fetchtest.NewServer(prs...)
		DeferCleanup(server.Close)
	}

	run := func(since time.Time) error {
		logger := slog.New(slog.NewJSONHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
		client := ghapi.NewClient(server.URL, token,
			ghapi.WithHTTPClient(server.Client()),
			ghapi.WithLogger(logger),
			ghapi.WithBackoff(func(_ context.Context, attempt int) error {
				waits = append(waits, attempt)
				return nil
			}))
		return fetch.Run(context.Background(), client, fetch.Config{
			CacheDir:       cacheDir,
			Since:          since,
			PageSize:       pageSize,
			NestedPageSize: 2,
			Logger:         logger,
			Now:            func() time.Time { return walkStart },
		})
	}

	entry := func(number int) fetch.Entry {
		e, err := fetch.ReadEntry(cacheDir, number)
		Expect(err).NotTo(HaveOccurred(), "entry %d", number)
		return e
	}

	rawFiles := func() []string {
		des, err := os.ReadDir(filepath.Join(cacheDir, "raw"))
		Expect(err).NotTo(HaveOccurred())
		var names []string
		for _, de := range des {
			names = append(names, de.Name())
		}
		return names
	}

	// listed returns the page sizes of the PullRequests requests whose
	// states variable is (open) or is not (!open) set.
	listed := func(open bool) []int {
		var firsts []int
		for _, r := range server.Operations(ghapi.PullRequests.Name) {
			if _, ok := r.Variables["states"]; ok == open {
				firsts = append(firsts, r.Int("first"))
			}
		}
		return firsts
	}

	nestedFor := func(c ghapi.Connection, number int) []string {
		var afters []string
		for _, r := range server.Operations(ghapi.ConnectionPage(c).Name) {
			if r.Int("number") == number {
				afters = append(afters, r.String("after"))
			}
		}
		return afters
	}

	It("caches a PR with every page of its commits, comments and reviews, in order", func() {
		want := pr(1, 5, "MERGED")
		want.MergedAt = new(at(5))
		want.Labels = []fetch.Label{{Name: "rgw"}, {Name: "tests"}, {Name: "backport"}}
		want.Commits = commits(6)
		want.Comments = comments(3)
		want.Reviews = reviews(4)
		want.TimelineItems = []fetch.Event{
			{Typename: "ReadyForReviewEvent", CreatedAt: at(-50)},
			{Typename: "MergedEvent", CreatedAt: at(5)},
		}
		serve(want)

		Expect(run(fetch.WindowStart)).To(Succeed())

		want.FetchedAt = walkStart
		Expect(entry(1)).To(Equal(want))
		Expect(nestedFor(ghapi.Commits, 1)).To(Equal([]string{"o2", "o4"}))
		Expect(nestedFor(ghapi.Comments, 1)).To(Equal([]string{"o2"}))
		Expect(nestedFor(ghapi.Reviews, 1)).To(Equal([]string{"o2"}))
		Expect(nestedFor(ghapi.Labels, 1)).To(Equal([]string{"o2"}))
		Expect(nestedFor(ghapi.TimelineItems, 1)).To(BeEmpty())
	})

	It("stores a null author as ghost", func() {
		p := pr(2, 5, "CLOSED")
		p.Author = nil
		p.Comments = []fetch.Comment{{CreatedAt: at(1), Body: "hi"}}
		p.Reviews = []fetch.Review{{SubmittedAt: new(at(2)), State: "APPROVED"}}
		serve(p)

		Expect(run(fetch.WindowStart)).To(Succeed())

		ghost := &fetch.Actor{Login: "ghost", Typename: "User"}
		e := entry(2)
		Expect(e.Author).To(Equal(ghost))
		Expect(e.Comments[0].Author).To(Equal(ghost))
		Expect(e.Reviews[0].Author).To(Equal(ghost))
	})

	It("stops at the first PR updated before --since and does not request the next page", func() {
		serve(pr(5, 5, "CLOSED"), pr(4, 4, "CLOSED"), pr(3, 3, "CLOSED"), pr(2, 2, "CLOSED"), pr(1, 1, "CLOSED"))
		pageSize = 2

		Expect(run(at(3))).To(Succeed())

		Expect(listed(false)).To(Equal([]int{2, 2}), "phase 1 list requests")
		Expect(rawFiles()).To(ConsistOf("3.json", "4.json", "5.json"))
	})

	It("caches a PR listed twice once, at the later updatedAt, and skips one listed twice unchanged", func() {
		moving := pr(8, 8, "OPEN")
		moving.Comments = comments(3)
		still := pr(9, 9, "OPEN")
		still.Comments = comments(3)
		serve(moving, still)
		server.After(func(n int, _ fetchtest.Request) {
			if n == 0 {
				server.Update(8, func(e *fetch.Entry) {
					e.UpdatedAt = at(20)
					e.Comments = append(e.Comments, fetch.Comment{CreatedAt: at(19), Body: "late", Author: user("dave")})
				})
			}
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		e := entry(8)
		Expect(e.UpdatedAt).To(Equal(at(20)))
		Expect(e.Comments).To(HaveLen(4))
		Expect(e.Comments[3].Body).To(Equal("late"))
		Expect(nestedFor(ghapi.Comments, 8)).To(HaveLen(2), "PR 8 is fetched in both phases")
		Expect(nestedFor(ghapi.Comments, 9)).To(HaveLen(1), "PR 9 is fetched once")
		Expect(rawFiles()).To(ConsistOf("8.json", "9.json"))
	})

	It("makes no nested-page requests on a second run over an unchanged server", func() {
		open := pr(3, 3, "OPEN")
		open.Commits = commits(5)
		closed := pr(2, 2, "CLOSED")
		closed.Reviews = reviews(3)
		serve(open, closed)
		Expect(run(fetch.WindowStart)).To(Succeed())
		first := len(server.Requests())
		before, err := os.ReadFile(filepath.Join(cacheDir, "raw", "3.json"))
		Expect(err).NotTo(HaveOccurred())

		Expect(run(fetch.WindowStart)).To(Succeed())

		var ops []string
		for _, r := range server.Requests()[first:] {
			ops = append(ops, r.Operation)
		}
		Expect(ops).To(HaveEach(BeElementOf(ghapi.PullRequests.Name, ghapi.Counts.Name)))
		Expect(os.ReadFile(filepath.Join(cacheDir, "raw", "3.json"))).To(Equal(before))
	})

	It("retries two empty responses and then succeeds at the same page size", func() {
		serve(pr(1, 1, "CLOSED"))
		server.Intercept(func(n int, _ fetchtest.Request) *fetchtest.Reply {
			if n < 2 {
				return &fetchtest.Reply{Status: 200}
			}
			return nil
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(listed(false)).To(Equal([]int{25, 25, 25}))
		Expect(waits).To(Equal([]int{1, 2}))
		Expect(rawFiles()).To(ConsistOf("1.json"))
	})

	It("halves the page size after three failures and keeps the smaller size", func() {
		var prs []fetch.Entry
		for n := range 8 {
			prs = append(prs, pr(n+1, n+1, "CLOSED"))
		}
		serve(prs...)
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if r.Operation == ghapi.PullRequests.Name && r.Int("first") > 6 {
				return &fetchtest.Reply{Status: 502, Body: "<html>bad gateway</html>"}
			}
			return nil
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(listed(false)).To(Equal([]int{25, 25, 25, 12, 12, 12, 6, 6}))
		Expect(listed(true)).To(Equal([]int{6}))
		Expect(rawFiles()).To(HaveLen(8))
	})

	It("gives up after three failures at a page size of 1", func() {
		serve(pr(1, 1, "CLOSED"))
		server.Intercept(func(int, fetchtest.Request) *fetchtest.Reply {
			return &fetchtest.Reply{Status: 503}
		})

		err := run(fetch.WindowStart)

		Expect(err).To(MatchError(ghapi.ErrUnavailable))
		Expect(listed(false)).To(Equal([]int{25, 25, 25, 12, 12, 12, 6, 6, 6, 3, 3, 3, 1, 1, 1}))
	})

	It("ends the run on a rate limit, naming the reset time, and keeps earlier entries", func() {
		serve(pr(3, 3, "CLOSED"), pr(2, 2, "CLOSED"), pr(1, 1, "CLOSED"))
		pageSize = 1
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if r.Operation == ghapi.PullRequests.Name && r.Variables["after"] == "o2" {
				return &fetchtest.Reply{Status: 403, Header: map[string]string{
					"x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794747600",
				}}
			}
			return nil
		})

		err := run(fetch.WindowStart)

		rl, ok := errors.AsType[*ghapi.RateLimitError](err)
		Expect(ok).To(BeTrue(), "error %v is not a RateLimitError", err)
		Expect(rl.Reset).To(BeTemporally("==", time.Date(2026, 11, 15, 13, 0, 0, 0, time.UTC)))
		Expect(err.Error()).To(ContainSubstring("2026-11-15T13:00:00Z"))
		Expect(rawFiles()).To(ConsistOf("3.json", "2.json"), "only whole entries, no temporary files")
		Expect(entry(3).Number).To(Equal(3))
		Expect(entry(2).Number).To(Equal(2))
		Expect(filepath.Join(cacheDir, "meta.json")).NotTo(BeAnExistingFile())
	})

	It("keeps the token out of every log line and every cache file", func() {
		serve(pr(2, 2, "OPEN"), pr(1, 1, "CLOSED"))
		server.Intercept(func(n int, _ fetchtest.Request) *fetchtest.Reply {
			if n == 0 {
				return &fetchtest.Reply{Status: 502}
			}
			return nil
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(server.Requests()).To(HaveEach(HaveField("Authorization", "bearer "+token)))
		Expect(logs.String()).To(ContainSubstring("retrying graphql request"))
		Expect(logs.String()).NotTo(ContainSubstring(token))
		Expect(filepath.WalkDir(cacheDir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if bytes.Contains(b, []byte(token)) {
				return fmt.Errorf("token in %s", path)
			}
			return nil
		})).To(Succeed())
	})

	It("records each new human author's prior PRs and GitHub's counts", func() {
		bot := pr(4, 4, "CLOSED")
		bot.Author = &fetch.Actor{Login: "dependabot", Typename: "Bot"}
		ghost := pr(3, 3, "CLOSED")
		ghost.Author = nil
		known := pr(2, 2, "OPEN")
		known.Author = user("carol")
		bob := pr(5, 5, "OPEN")
		bob.Author = user("bob")
		serve(pr(1, 1, "CLOSED"), pr(6, 6, "MERGED"), bot, ghost, known, bob)
		server.SetCounts(42, map[string]int{"alice": 3, "bob": 0, "carol": 99})
		Expect(os.WriteFile(filepath.Join(cacheDir, "authors.json"), []byte(`{"carol": 7}`), 0o600)).To(Succeed())

		Expect(run(fetch.WindowStart)).To(Succeed())

		baselines := server.Operations(ghapi.AuthorBaselines(0).Name)
		Expect(baselines).To(HaveLen(1))
		Expect(baselines[0].Variables).To(Equal(map[string]any{
			"q0": "repo:ceph/ceph is:pr author:alice created:<2026-05-15",
			"q1": "repo:ceph/ceph is:pr author:bob created:<2026-05-15",
		}))
		Expect(readJSON(filepath.Join(cacheDir, "authors.json"))).To(Equal(map[string]any{
			"alice": 3.0, "bob": 0.0, "carol": 7.0,
		}))

		counts := server.Operations(ghapi.Counts.Name)
		Expect(counts).To(HaveLen(1))
		Expect(counts[0].Variables).To(HaveKeyWithValue("search", "repo:ceph/ceph is:pr created:>=2026-05-15"))
		Expect(readJSON(filepath.Join(cacheDir, "meta.json"))).To(Equal(map[string]any{
			"walk_started":     "2026-11-15T12:00:00Z",
			"opened_in_window": 42.0,
			"open":             2.0,
		}))
	})

	It("asks for at most 25 authors in one request", func() {
		var prs []fetch.Entry
		for n := range 27 {
			p := pr(n+1, n+1, "CLOSED")
			p.Author = user(fmt.Sprintf("dev%02d", n))
			prs = append(prs, p)
		}
		serve(prs...)

		Expect(run(fetch.WindowStart)).To(Succeed())

		var sizes []int
		for _, r := range server.Operations(ghapi.AuthorBaselines(0).Name) {
			sizes = append(sizes, len(r.Variables))
		}
		Expect(sizes).To(Equal([]int{25, 2}))
		Expect(readJSON(filepath.Join(cacheDir, "authors.json"))).To(HaveLen(27))
	})
})

var _ = Describe("DefaultSince", func() {
	var dataDir string

	BeforeEach(func() {
		dataDir = GinkgoT().TempDir()
	})

	It("is the window start when there is no meta", func() {
		Expect(fetch.DefaultSince(dataDir)).To(Equal(fetch.WindowStart))
	})

	It("is a day before the last fetch", func() {
		Expect(os.WriteFile(filepath.Join(dataDir, "meta.json"),
			[]byte(`{"repo":"ceph/ceph","fetched_through":"2026-11-10T06:00:00Z","open":3}`), 0o600)).To(Succeed())

		Expect(fetch.DefaultSince(dataDir)).To(Equal(time.Date(2026, 11, 9, 6, 0, 0, 0, time.UTC)))
	})

	It("is an error naming the file when the meta cannot be read", func() {
		path := filepath.Join(dataDir, "meta.json")
		Expect(os.WriteFile(path, []byte(`{"fetched_through":"yesterday"}`), 0o600)).To(Succeed())

		_, err := fetch.DefaultSince(dataDir)

		Expect(err).To(MatchError(ContainSubstring(path)))
	})
})

func readJSON(path string) map[string]any {
	b, err := os.ReadFile(path)
	Expect(err).NotTo(HaveOccurred())
	var out map[string]any
	Expect(json.Unmarshal(b, &out)).To(Succeed(), "%s: %s", path, b)
	return out
}
