package ghapi_test

import (
	"regexp"
	"slices"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

var (
	declared = regexp.MustCompile(`\$(\w+):`)
	used     = regexp.MustCompile(`\$(\w+)\b[^:]`)
)

var _ = Describe("queries", func() {
	names := func(re *regexp.Regexp, s string) []string {
		var out []string
		for _, m := range re.FindAllStringSubmatch(s, -1) {
			if !slices.Contains(out, m[1]) {
				out = append(out, m[1])
			}
		}
		slices.Sort(out)
		return out
	}

	all := func() []ghapi.Query {
		qs := []ghapi.Query{ghapi.PullRequests, ghapi.Counts, ghapi.AuthorBaselines(3)}
		for _, c := range ghapi.Connections {
			qs = append(qs, ghapi.ConnectionPage(c))
		}
		return qs
	}

	It("names each operation as it is declared", func() {
		for _, q := range all() {
			Expect(q.Text).To(HavePrefix("query "+q.Name+"("), "query %s", q.Name)
		}
	})

	It("balances braces and parentheses", func() {
		for _, q := range all() {
			Expect(strings.Count(q.Text, "{")).To(Equal(strings.Count(q.Text, "}")), "braces in %s", q.Name)
			Expect(strings.Count(q.Text, "(")).To(Equal(strings.Count(q.Text, ")")), "parentheses in %s", q.Name)
		}
	})

	It("uses every variable it declares and declares every variable it uses", func() {
		for _, q := range all() {
			header, body, ok := strings.Cut(q.Text, ")")
			Expect(ok).To(BeTrue(), "query %s has no variable list", q.Name)
			Expect(names(used, body)).To(Equal(names(declared, header)), "query %s", q.Name)
		}
	})

	It("selects every connection on a listed pull request", func() {
		for _, c := range ghapi.Connections {
			Expect(ghapi.PullRequests.Text).To(ContainSubstring(string(c)+"(first: $nested"), "connection %s", c)
		}
	})

	DescribeTable("selects the fields of a node, link fields included, in the list and in its connection's further pages",
		func(c ghapi.Connection, selection string) {
			Expect(ghapi.PullRequests.Text).To(ContainSubstring(selection), "PullRequests")
			Expect(ghapi.ConnectionPage(c).Text).To(ContainSubstring(selection), "%s", ghapi.ConnectionPage(c).Name)
		},
		Entry("a commit's oid", ghapi.Commits, "nodes { commit { oid authoredDate committedDate message } }"),
		Entry("a comment's fullDatabaseId", ghapi.Comments, "nodes { fullDatabaseId createdAt body author { login __typename } }"),
		Entry("a review's fullDatabaseId", ghapi.Reviews, "nodes { fullDatabaseId submittedAt state author { login __typename } }"),
		Entry("a ready event's url", ghapi.TimelineItems, "... on ReadyForReviewEvent { createdAt url }"),
		Entry("a draft event's url", ghapi.TimelineItems, "... on ConvertToDraftEvent { createdAt url }"),
		Entry("a force-push's commits before and after", ghapi.TimelineItems, "... on HeadRefForcePushedEvent { createdAt beforeCommit { oid } afterCommit { oid } }"),
		Entry("a close's url", ghapi.TimelineItems, "... on ClosedEvent { createdAt url }"),
		Entry("a reopening without a url, which GitHub does not have", ghapi.TimelineItems, "... on ReopenedEvent { createdAt }"),
		Entry("a merge's url and merge commit", ghapi.TimelineItems, "... on MergedEvent { createdAt url commit { oid } }"),
	)

	It("asks for no databaseId, which GitHub deprecates for 64-bit ids", func() {
		for _, q := range all() {
			Expect(q.Text).NotTo(MatchRegexp(`\bdatabaseId\b`), "query %s", q.Name)
		}
	})

	It("asks for the repository's creation and its listing's totals beside the search", func() {
		Expect(ghapi.Counts.Text).To(ContainSubstring("search(query: $search, type: ISSUE, first: 1) { issueCount }"))
		Expect(ghapi.Counts.Text).To(ContainSubstring("createdAt"))
		Expect(ghapi.Counts.Text).To(ContainSubstring("total: pullRequests { totalCount }"))
		Expect(ghapi.Counts.Text).To(ContainSubstring("open: pullRequests(states: OPEN) { totalCount }"))
	})

	It("asks for one aliased search per author", func() {
		q := ghapi.AuthorBaselines(25)
		Expect(strings.Count(q.Text, "search(")).To(Equal(25))
		Expect(q.Text).To(ContainSubstring("a24: search(query: $q24"))
	})
})
