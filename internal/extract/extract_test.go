package extract_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/extract"
	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
)

func fixture(name string) fetch.Entry {
	GinkgoHelper()
	b, err := os.ReadFile(filepath.Join("testdata", name+".json"))
	Expect(err).NotTo(HaveOccurred())
	var e fetch.Entry
	Expect(json.Unmarshal(b, &e)).To(Succeed(), "fixture %s", name)
	return e
}

// entry is a minimal cached pull request by login, opened at created.
func entry(number int, login string, created time.Time) fetch.Entry {
	return fetch.Entry{
		Number: number, Title: "a pull request", State: "OPEN",
		CreatedAt: created, UpdatedAt: created, BaseRefName: "main",
		AuthorAssociation: "MEMBER",
		Author:            &fetch.Actor{Login: login, Typename: "User"},
		Labels:            []fetch.Label{}, Commits: []fetch.Commit{}, Comments: []fetch.Comment{},
		Reviews: []fetch.Review{}, TimelineItems: []fetch.Event{},
	}
}

var _ = Describe("FromEntry", func() {
	DescribeTable("gives the expected record",
		func(name string) {
			r, err := extract.FromEntry(fixture(name))
			Expect(err).NotTo(HaveOccurred())

			got, err := json.Marshal(r)
			Expect(err).NotTo(HaveOccurred())
			want, err := os.ReadFile(filepath.Join("testdata", name+".record.json"))
			Expect(err).NotTo(HaveOccurred())
			Expect(got).To(MatchJSON(want), "fixture %s", name)
		},
		Entry("a backport: cherry-picked commits authored months before, trailers above the Conflicts paragraph", "backport"),
		Entry("a draft later marked ready, back to draft and ready again", "draft-ready"),
		Entry("a PR closed, reopened, then merged, with reviews listed out of order", "reopened"),
		Entry("a PR force-pushed three times", "force-pushed"),
		Entry("a closed draft whose commits all postdate its opening, with offset commit times", "late-commits"),
		Entry("null authors on the PR, a comment and a review", "ghost"),
	)

	Describe("a comment's text", func() {
		text := func(body string) string {
			GinkgoHelper()
			e := entry(1, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
			e.Comments = []fetch.Comment{{CreatedAt: e.CreatedAt, Body: body, Author: &fetch.Actor{Login: "bob", Typename: "User"}}}
			r, err := extract.FromEntry(e)
			Expect(err).NotTo(HaveOccurred())
			Expect(r.Comments).To(HaveLen(1))
			return r.Comments[0].Text
		}

		It("is kept for one line of 80 characters", func() {
			line := strings.Repeat("x", 80)
			Expect(text(line)).To(Equal(line))
		})

		It("is not kept for one line of 81 characters", func() {
			Expect(text(strings.Repeat("x", 81))).To(BeEmpty())
		})

		It("counts characters rather than bytes", func() {
			line := strings.Repeat("é", 80)
			Expect(text(line)).To(Equal(line))
		})

		It("is trimmed before it is measured", func() {
			Expect(text("  /audit retest \r\n")).To(Equal("/audit retest"))
			Expect(text(" " + strings.Repeat("x", 80) + "\n\n")).To(Equal(strings.Repeat("x", 80)))
		})

		It("is not kept for a comment of more than one line", func() {
			Expect(text("jenkins test make check\njenkins test api")).To(BeEmpty())
			Expect(text("jenkins test make check\r\njenkins test api")).To(BeEmpty())
		})
	})

	It("truncates every time to the second in UTC", func() {
		e := entry(1, "alice", time.Date(2026, 6, 1, 12, 0, 0, 900_000_000, time.FixedZone("x", 3600)))

		r, err := extract.FromEntry(e)

		Expect(err).NotTo(HaveOccurred())
		Expect(r.Created).To(Equal(time.Date(2026, 6, 1, 11, 0, 0, 0, time.UTC)))
	})

	It("is an error naming the PR for a state it does not know", func() {
		e := entry(42, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
		e.State = "LOCKED"

		_, err := extract.FromEntry(e)

		Expect(err).To(MatchError(`pull request 42: unknown state "LOCKED"`))
	})

	It("is an error naming the PR for an event it does not know", func() {
		e := entry(42, "alice", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
		e.TimelineItems = []fetch.Event{{Typename: "LabeledEvent", CreatedAt: e.CreatedAt}}

		_, err := extract.FromEntry(e)

		Expect(err).To(MatchError(`pull request 42: unknown event "LabeledEvent"`))
	})
})
