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

	It("selects every connection on a listed pull request, with createdAt on each event type", func() {
		for _, c := range ghapi.Connections {
			Expect(ghapi.PullRequests.Text).To(ContainSubstring(string(c)+"(first: $nested"), "connection %s", c)
		}
		for _, ev := range []string{"ReadyForReviewEvent", "ConvertToDraftEvent", "HeadRefForcePushedEvent", "ClosedEvent", "ReopenedEvent", "MergedEvent"} {
			Expect(ghapi.PullRequests.Text).To(ContainSubstring("... on "+ev+" { createdAt }"), "event %s", ev)
		}
	})

	It("asks for one aliased search per author", func() {
		q := ghapi.AuthorBaselines(25)
		Expect(strings.Count(q.Text, "search(")).To(Equal(25))
		Expect(q.Text).To(ContainSubstring("a24: search(query: $q24"))
	})
})
