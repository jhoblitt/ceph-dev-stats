package classify

import (
	"cmp"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
	"github.com/jhoblitt/ceph-dev-stats/internal/tables"
	"github.com/jhoblitt/ceph-dev-stats/internal/tracker"
)

const (
	// minLabelPRs is how many pull requests a label must be on before it
	// must be classified.
	minLabelPRs = 5
	// maxNamed is how many pull requests or tickets a problem names.
	maxNamed = 5
)

// CheckInput is what Check validates the tables against.
type CheckInput struct {
	Tables  *tables.Tables
	Tickets map[int]tracker.Ticket
	Records []record.Record
	// Meta is nil when there is no meta.json.
	Meta *record.Meta
	// Top is how many entries each report lists; 0 lists all.
	Top int
}

// Check classifies the records and writes reports for whoever tunes the
// tables to out: the description and commit-prose candidates that match no
// phrase, the short comments by people that match no command, the
// accounts not typed bots with the most comments, and the base branches,
// each most frequent first. Its error lists every problem the tables leave
// in the data:
//   - a trailer candidate whose key is neither a trailer key nor
//     Co-authored-by, and that ignore does not list;
//   - a counted disclosure that matches no family;
//   - a label on 5 or more pull requests that no table classifies;
//   - a ticket type in tickets.json that kinds.yaml does not map;
//   - record counts more than 0.5% from GitHub's counts in meta.json.
func Check(in CheckInput, out io.Writer) error {
	t := in.Tables
	prs := Records(t, in.Tickets, in.Records)

	var errs []error
	unknownKey, noFamily := map[string][]int{}, map[string][]int{}
	unmatched := map[string]int{}
	for i := range prs {
		p := &prs[i]
		// A line can be in more than one of a record's lists; trailers come
		// first, so a trailer's problem is the one reported.
		seen := map[string]bool{}
		for _, c := range p.Candidates {
			if c.Ignored || seen[c.Text] {
				continue
			}
			seen[c.Text] = true
			switch {
			case c.Class != "" && c.Family == "":
				noFamily[c.Text] = append(noFamily[c.Text], p.Number)
			case c.Class == "" && c.From == FromTrailers:
				unknownKey[c.Text] = append(unknownKey[c.Text], p.Number)
			case c.Class == "":
				unmatched[c.Text]++
			}
		}
	}
	for _, text := range slices.Sorted(maps.Keys(unknownKey)) {
		key, _, _ := strings.Cut(text, ":")
		errs = append(errs, fmt.Errorf("%s: trailer %q (%s) has key %q, which is not in trailer_keys or Co-authored-by, and no ignore entry lists it",
			tables.ToolsFile, text, prList(unknownKey[text]), strings.ToLower(strings.TrimSpace(key))))
	}
	for _, text := range slices.Sorted(maps.Keys(noFamily)) {
		errs = append(errs, fmt.Errorf("%s: disclosure %q (%s) matches no family", tables.ToolsFile, text, prList(noFamily[text])))
	}
	errs = append(errs, labelProblems(t, in.Records)...)
	errs = append(errs, ticketProblems(t, in.Tickets)...)
	counts, countErrs := compareCounts(in.Records, in.Meta)
	errs = append(errs, countErrs...)

	fmt.Fprintln(out, counts)
	report(out, "Description and commit-prose candidates that match no phrase", unmatched, in.Top)
	comments, accounts, bases := map[string]int{}, map[string]int{}, map[string]int{}
	for i := range in.Records {
		r := &in.Records[i]
		bases[r.Base]++
		for j, c := range r.Comments {
			if k := prs[i].Comments[j].Kind; c.Text != "" && (k == CommentAuthor || k == CommentOther) {
				comments[strings.ToLower(c.Text)]++
			}
			if !c.Bot {
				login := c.By
				if t.Bots.Listed(login) {
					login += " (" + tables.BotsFile + ")"
				}
				accounts[login]++
			}
		}
	}
	report(out, "Short comments by people that match no command", comments, in.Top)
	report(out, "Accounts with the most comments, not typed bots by GitHub", accounts, in.Top)
	report(out, "Base branches", bases, 0)
	return errors.Join(errs...)
}

func labelProblems(t *tables.Tables, recs []record.Record) []error {
	on := map[string]int{}
	for i := range recs {
		for _, l := range recs[i].Labels {
			on[l]++
		}
	}
	var errs []error
	for _, l := range slices.Sorted(maps.Keys(on)) {
		if _, kind := t.Kinds.Labels[l]; on[l] >= minLabelPRs && !kind && !t.Labels.Classified(l) {
			errs = append(errs, fmt.Errorf("%s: label %q is on %d pull requests and no table classifies it", tables.LabelsFile, l, on[l]))
		}
	}
	return errs
}

func ticketProblems(t *tables.Tables, tickets map[int]tracker.Ticket) []error {
	unmapped := map[string][]int{}
	for id, tk := range tickets {
		if _, ok := t.Kinds.Tracker[tk.Type]; tk.Type != "" && !ok {
			unmapped[tk.Type] = append(unmapped[tk.Type], id)
		}
	}
	var errs []error
	for _, typ := range slices.Sorted(maps.Keys(unmapped)) {
		errs = append(errs, fmt.Errorf("%s: ticket type %q in %s (tickets %s) has no tracker entry",
			tables.KindsFile, typ, tracker.File, list(unmapped[typ], "")))
	}
	return errs
}

// compareCounts allows the records and GitHub's counts to differ by 0.5%,
// for pull requests opened or closed while the walk ran.
func compareCounts(recs []record.Record, meta *record.Meta) (string, []error) {
	if meta == nil {
		return "Counts: no " + record.MetaFile + " to compare with", nil
	}
	start := meta.WindowStart
	if start.IsZero() {
		start = fetch.WindowStart
	}
	opened, open := 0, 0
	for i := range recs {
		if !recs[i].Created.Before(start) {
			opened++
		}
		if recs[i].State == record.StateOpen {
			open++
		}
	}
	gh := meta.GitHubCounts
	var errs []error
	if apart(opened, gh.OpenedInWindow) {
		errs = append(errs, fmt.Errorf("%s: the records hold %d pull requests opened in the window, GitHub counted %d: more than 0.5%% apart",
			record.MetaFile, opened, gh.OpenedInWindow))
	}
	if apart(open, gh.Open) {
		errs = append(errs, fmt.Errorf("%s: the records hold %d open pull requests, GitHub counted %d: more than 0.5%% apart",
			record.MetaFile, open, gh.Open))
	}
	line := fmt.Sprintf("Counts: %d opened in the window (GitHub: %d), %d open (GitHub: %d)", opened, gh.OpenedInWindow, open, gh.Open)
	return line, errs
}

func apart(got, github int) bool {
	d := got - github
	if d < 0 {
		d = -d
	}
	return 1000*d > 5*github
}

// report writes counts most frequent first, then by text, at most top of
// them when top is above zero.
func report(out io.Writer, title string, counts map[string]int, top int) {
	keys := slices.SortedFunc(maps.Keys(counts), func(a, b string) int {
		return cmp.Or(cmp.Compare(counts[b], counts[a]), cmp.Compare(a, b))
	})
	fmt.Fprintf(out, "%s: %d\n", title, len(keys))
	for i, k := range keys {
		if top > 0 && i == top {
			fmt.Fprintf(out, "    and %d more\n", len(keys)-top)
			break
		}
		fmt.Fprintf(out, "%7d  %s\n", counts[k], k)
	}
}

func prList(numbers []int) string {
	return list(numbers, "#")
}

// list names the first few of ids in order, each with prefix.
func list(ids []int, prefix string) string {
	ids = slices.Sorted(slices.Values(ids))
	var b strings.Builder
	for i, id := range ids {
		if i == maxNamed {
			fmt.Fprintf(&b, " and %d more", len(ids)-maxNamed)
			break
		}
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(prefix + strconv.Itoa(id))
	}
	return b.String()
}
