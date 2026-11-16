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
	"strings"
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

// sha is a commit id that tells commit i apart.
func sha(i int) string { return fmt.Sprintf("%040x", 0xc0ffee00+i) }

func commits(n int) []fetch.Commit {
	out := make([]fetch.Commit, n)
	for i := range out {
		out[i] = fetch.Commit{OID: sha(i), AuthoredDate: at(-90 + i), CommittedDate: at(-80 + i), Message: fmt.Sprintf("commit %d", i)}
	}
	return out
}

func comments(n int) []fetch.Comment {
	out := make([]fetch.Comment, n)
	for i := range out {
		out[i] = fetch.Comment{DatabaseID: 4854682435 + int64(i), CreatedAt: at(-70 + i), Body: fmt.Sprintf("comment %d", i), Author: user("bob")}
	}
	return out
}

func reviews(n int) []fetch.Review {
	out := make([]fetch.Review, n)
	for i := range out {
		out[i] = fetch.Review{DatabaseID: 3954682435 + int64(i), SubmittedAt: new(at(-60 + i)), State: "COMMENTED", Author: user("carol")}
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
		// defaultSince marks run's since as the default, not the operator's.
		defaultSince bool
		// defaultSinceAt is run's Config.DefaultSince.
		defaultSinceAt time.Time
	)

	BeforeEach(func() {
		cacheDir = GinkgoT().TempDir()
		pageSize = 0
		waits = nil
		logs = &bytes.Buffer{}
		defaultSince = false
		defaultSinceAt = time.Time{}
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
			SinceIsDefault: defaultSince,
			DefaultSince:   defaultSinceAt,
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

	// logged returns the log records with message msg.
	logged := func(msg string) []map[string]any {
		GinkgoHelper()
		var out []map[string]any
		for line := range bytes.Lines(logs.Bytes()) {
			var m map[string]any
			Expect(json.Unmarshal(line, &m)).To(Succeed(), "log line %s", line)
			if m["msg"] == msg {
				out = append(out, m)
			}
		}
		return out
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
		want.FormatVersion = fetch.FormatVersion
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

	// serveLinksPage answers the walk's first list request with the page in
	// testdata/links-page.json, after edit.
	serveLinksPage := func(edit func(string) string) {
		GinkgoHelper()
		page, err := os.ReadFile(filepath.Join("testdata", "links-page.json"))
		Expect(err).NotTo(HaveOccurred())
		body := edit(string(page))
		serve()
		server.Intercept(func(_ int, r fetchtest.Request) *fetchtest.Reply {
			if _, open := r.Variables["states"]; r.Operation == ghapi.PullRequests.Name && !open {
				return &fetchtest.Reply{Status: 200, Body: body}
			}
			return nil
		})
	}

	It("is an error naming the PR when a fullDatabaseId is not a number, and does not retry it", func() {
		serveLinksPage(func(s string) string {
			return strings.Replace(s, `"fullDatabaseId": "4854682435"`, `"fullDatabaseId": "48x"`, 1)
		})

		err := run(fetch.WindowStart)

		Expect(err).To(MatchError(And(ContainSubstring("pull request 69877"), ContainSubstring(`"48x"`))))
		Expect(err).NotTo(MatchError(ghapi.ErrUnavailable))
		Expect(server.Operations(ghapi.PullRequests.Name)).To(HaveLen(1))
	})

	It("caches no id for a comment whose fullDatabaseId is null", func() {
		serveLinksPage(func(s string) string {
			return strings.Replace(s, `"fullDatabaseId": "4854682435"`, `"fullDatabaseId": null`, 1)
		})

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(entry(69877).Comments).To(HaveExactElements(HaveField("DatabaseID", BeZero())))
	})

	It("caches the ids, addresses and SHAs that links to GitHub are built from, under GitHub's names", func() {
		serveLinksPage(func(s string) string { return s })

		Expect(run(fetch.WindowStart)).To(Succeed())

		ts := func(s string) time.Time {
			GinkgoHelper()
			t, err := time.Parse(time.RFC3339, s)
			Expect(err).NotTo(HaveOccurred())
			return t
		}
		ref := func(oid string) *fetch.CommitRef { return &fetch.CommitRef{OID: oid} }
		const addr = "https://github.com/ceph/ceph/pull/69877#event-"
		e := entry(69877)
		Expect(e.FormatVersion).To(Equal(fetch.FormatVersion))
		Expect(e.Commits).To(HaveExactElements(
			HaveField("OID", "3f9a1c0d2b4e6f8a0c1e3d5b7f9a1c3e5d7b9f1a"),
			HaveField("OID", "8b2d4f6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c"),
		))
		Expect(e.Comments).To(HaveExactElements(HaveField("DatabaseID", int64(4854682435))))
		Expect(e.Reviews).To(HaveExactElements(HaveField("DatabaseID", int64(3412345678))))
		Expect(e.TimelineItems).To(Equal([]fetch.Event{
			{Typename: "ReadyForReviewEvent", CreatedAt: ts("2026-10-28T20:00:00Z"), URL: addr + "28644873432"},
			{
				Typename: "HeadRefForcePushedEvent", CreatedAt: ts("2026-10-29T18:00:00Z"),
				BeforeCommit: ref("1111111111111111111111111111111111111111"),
				AfterCommit:  ref("8b2d4f6a8c0e2a4c6e8a0c2e4a6c8e0a2c4e6a8c"),
			},
			{Typename: "HeadRefForcePushedEvent", CreatedAt: ts("2026-10-29T19:00:00Z")},
			{Typename: "ClosedEvent", CreatedAt: ts("2026-10-30T01:00:00Z"), URL: addr + "28644900001"},
			{Typename: "ReopenedEvent", CreatedAt: ts("2026-10-30T02:00:00Z")},
			{Typename: "ConvertToDraftEvent", CreatedAt: ts("2026-10-30T03:00:00Z"), URL: addr + "28644900002"},
			{
				Typename: "MergedEvent", CreatedAt: ts("2026-11-01T05:00:00Z"), URL: addr + "28644900003",
				Commit: ref("c0ffee0000000000000000000000000000000001"),
			},
			{Typename: "ClosedEvent", CreatedAt: ts("2026-11-01T05:00:00Z"), URL: addr + "28644900004"},
		}))
		raw := readJSON(filepath.Join(cacheDir, "raw", "69877.json"))
		Expect(raw).To(HaveKeyWithValue("formatVersion", float64(fetch.FormatVersion)))
		Expect(raw).To(HaveKeyWithValue("comments", HaveExactElements(HaveKeyWithValue("fullDatabaseId", "4854682435"))),
			"the cache keeps GitHub's BigInt as a string")
		Expect(raw).To(HaveKeyWithValue("reviews", HaveExactElements(HaveKeyWithValue("fullDatabaseId", "3412345678"))))
	})

	It("fetches again an entry of an older format though its updatedAt is unchanged, and not one of the current format", func() {
		unversioned := pr(3, 3, "CLOSED")
		unversioned.Comments = comments(3)
		older := pr(4, 4, "CLOSED")
		older.Comments = comments(3)
		serve(unversioned, older)
		Expect(run(fetch.WindowStart)).To(Succeed())
		rewrite := func(number int, f func(map[string]any)) {
			GinkgoHelper()
			path := filepath.Join(cacheDir, "raw", strconv.Itoa(number)+".json")
			e := readJSON(path)
			f(e)
			b, err := json.Marshal(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
		}
		rewrite(3, func(e map[string]any) { delete(e, "formatVersion") })
		rewrite(4, func(e map[string]any) { e["formatVersion"] = fetch.FormatVersion - 1 })

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(nestedFor(ghapi.Comments, 3)).To(HaveLen(2), "PR 3, without a version, is fetched by both runs")
		Expect(nestedFor(ghapi.Comments, 4)).To(HaveLen(2), "PR 4, of an older version, is fetched by both runs")
		Expect(entry(3).FormatVersion).To(Equal(fetch.FormatVersion))
		Expect(entry(4).FormatVersion).To(Equal(fetch.FormatVersion))

		Expect(run(fetch.WindowStart)).To(Succeed())

		Expect(nestedFor(ghapi.Comments, 3)).To(HaveLen(2), "PR 3, now current, is not fetched by a third run")
		Expect(nestedFor(ghapi.Comments, 4)).To(HaveLen(2), "PR 4, now current, is not fetched by a third run")
	})

	Context("when the cache holds an entry of an older format that the since would not reach", func() {
		var since time.Time

		BeforeEach(func() {
			since = at(5)
			old, recent := pr(1, 1, "CLOSED"), pr(9, 9, "CLOSED")
			old.Comments, recent.Comments = comments(3), comments(3)
			serve(old, recent)
			Expect(run(fetch.WindowStart)).To(Succeed())
			path := filepath.Join(cacheDir, "raw", "1.json")
			e := readJSON(path)
			delete(e, "formatVersion")
			b, err := json.Marshal(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
			logs.Reset()
		})

		It("walks back to the window start from a default since, refetching it, and warns once why", func() {
			defaultSince = true

			Expect(run(since)).To(Succeed())

			Expect(nestedFor(ghapi.Comments, 1)).To(HaveLen(2), "PR 1 is fetched again")
			Expect(entry(1).FormatVersion).To(Equal(fetch.FormatVersion))
			Expect(logged("cache holds entries of an older format")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("entries", 1.0),
				HaveKeyWithValue("since", "2026-05-15T00:00:00Z"),
			)), "log:\n%s", logs.String())
		})

		It("walks from an explicit since as given, with the same warning", func() {
			Expect(run(since)).To(Succeed())

			Expect(nestedFor(ghapi.Comments, 1)).To(HaveLen(1), "PR 1 is not reached")
			Expect(entry(1).FormatVersion).To(BeZero())
			Expect(logged("cache holds entries of an older format")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("entries", 1.0),
				HaveKeyWithValue("since", "2026-11-01T05:00:00Z"),
			)), "log:\n%s", logs.String())
		})

		It("walks from a default since as before once every entry is current", func() {
			defaultSince = true
			Expect(run(since)).To(Succeed())
			logs.Reset()

			Expect(run(since)).To(Succeed())

			Expect(logged("cache holds entries of an older format")).To(BeEmpty())
			Expect(logged("reached since")).To(ContainElement(HaveKeyWithValue("phase", "updated")),
				"the walk stops at the default since, before PR 1; log:\n%s", logs.String())
			Expect(nestedFor(ghapi.Comments, 1)).To(HaveLen(2), "PR 1 is not fetched a third time")
		})
	})

	It("stops at the first PR updated before --since and does not request the next page", func() {
		serve(pr(5, 5, "CLOSED"), pr(4, 4, "CLOSED"), pr(3, 3, "CLOSED"), pr(2, 2, "CLOSED"), pr(1, 1, "CLOSED"))
		pageSize = 2

		Expect(run(at(3))).To(Succeed())

		Expect(listed(false)).To(Equal([]int{2, 2}), "phase 1 list requests")
		Expect(rawFiles()).To(ConsistOf("3.json", "4.json", "5.json"))
	})

	Describe("meta.json, the coverage mark", func() {
		metaPath := func() string { return filepath.Join(cacheDir, fetch.MetaFile) }

		BeforeEach(func() {
			serve(pr(9, 9, "CLOSED"), pr(1, 1, "CLOSED"))
			defaultSinceAt = at(5)
		})

		It("is left byte-identical by a walk from a since later than the default, which saves its entries and warns once why", func() {
			const old = `{"walk_started":"2026-10-01T00:00:00Z","opened_in_window":1,"open":0}` + "\n"
			Expect(os.WriteFile(metaPath(), []byte(old), 0o600)).To(Succeed())

			Expect(run(at(6))).To(Succeed())

			got, err := os.ReadFile(metaPath())
			Expect(err).NotTo(HaveOccurred())
			Expect(string(got)).To(Equal(old))
			Expect(rawFiles()).To(ConsistOf("9.json"))
			Expect(logged("coverage mark not advanced")).To(HaveExactElements(And(
				HaveKeyWithValue("level", "WARN"),
				HaveKeyWithValue("reason", ContainSubstring("later than the default since")),
				HaveKeyWithValue("since", "2026-11-01T06:00:00Z"),
				HaveKeyWithValue("default_since", "2026-11-01T05:00:00Z"),
			)), "log:\n%s", logs.String())
		})

		It("is not created by a walk from a since later than the default", func() {
			Expect(run(at(6))).To(Succeed())

			Expect(metaPath()).NotTo(BeAnExistingFile())
			Expect(rawFiles()).To(ConsistOf("9.json"))
		})

		DescribeTable("is written by a walk that covers the default range",
			func(since, defaultAt time.Time) {
				defaultSinceAt = defaultAt

				Expect(run(since)).To(Succeed())

				Expect(readJSON(metaPath())).To(HaveKeyWithValue("walk_started", "2026-11-15T12:00:00Z"))
				Expect(logged("coverage mark not advanced")).To(BeEmpty())
			},
			Entry("since at the default", at(5), at(5)),
			Entry("since before the default", at(4), at(5)),
			Entry("no default, as for --full, whatever the since", at(6), time.Time{}),
		)
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
