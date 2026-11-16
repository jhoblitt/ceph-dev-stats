package extract

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// The whole disclosure-candidate rule lives in this file. It finds
// candidates, never verdicts: the hand-edited tools table decides later,
// so the broad list errs towards keeping a line, and tuning it means
// re-deriving every record with extract --all.

// broad is the broad word list. Everything is case-insensitive except "AI",
// which is matched only as an upper-case word. "cursor" is a RADOS term, so
// Cursor is matched only by its agent address here, and as the value of a
// -by trailer below. "claude" stays unbounded, since values such as
// "IBM-Bob:ClaudeSonnet" run it into the next word; the words bounded here
// otherwise match inside "raider", "philanthropic" and "regenerated
// without".
var broad = regexp.MustCompile(`(?i:` +
	`claude|\banthropic\b|copilot|gemini|codex|chatgpt|openai|` +
	`\bgpt(?:\b|\d)|\bllms?\b|` +
	`\baider\b|windsurf|ibm[ -]bob|` +
	`assisted[ -]by|assistant[ -]by|\bgenerated[ -](?:with|by)\b|raised[ -]by|` +
	`cursoragent|cursor\.com` +
	`)|\bAI\b`)

// byValue is what else the value of a -by trailer may name.
var byValue = regexp.MustCompile(`(?i)\bcursor\b`)

// trailerLine is a `Key: value` line, the key one token of letters, digits
// and hyphens. A trailer anywhere in a message counts: a backport appends
// "(cherry picked from commit …)" and a Conflicts paragraph after the
// original trailers.
var trailerLine = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9-]*):(?:\s+(.*))?$`)

// neverKept are trailer keys, lower-cased, whose lines are never a
// candidate, whatever they say: they name people, addresses or links.
var neverKept = map[string]bool{
	"signed-off-by": true, "reviewed-by": true, "tested-by": true,
	"acked-by": true, "reported-by": true, "suggested-by": true,
	"cc": true, "fixes": true, "resolves": true, "see-also": true,
	"backport": true, "change-id": true, "conflicts": true,
	"link": true, "url": true,
}

// maxCandidate is the most characters of a line a candidate keeps.
const maxCandidate = 200

// Candidates finds the lines of a pull request's commit messages and
// description that might disclose LLM use:
//   - trailers: a commit trailer whose key matches the broad list, or whose
//     key ends in -by and whose value does, so a Co-authored-by naming a
//     person is not kept;
//   - commit_prose: any other commit-message line that matches;
//   - description: any description line that matches.
//
// A line with a never-kept key is dropped from all three. Each candidate is
// trimmed and cut at 200 characters, and each list is de-duplicated in
// order of first appearance.
func Candidates(messages []string, description string) record.Disclosure {
	trailers, prose, desc := newList(), newList(), newList()
	for _, m := range messages {
		for line := range strings.Lines(m) {
			line = strings.TrimSpace(line)
			key, value, isTrailer := splitTrailer(line)
			switch {
			case isTrailer && neverKept[key]:
			case isTrailer && keepTrailer(key, value):
				trailers.add(line)
			case broad.MatchString(line):
				prose.add(line)
			}
		}
	}
	for line := range strings.Lines(description) {
		line = strings.TrimSpace(line)
		if key, _, isTrailer := splitTrailer(line); isTrailer && neverKept[key] {
			continue
		}
		if broad.MatchString(line) {
			desc.add(line)
		}
	}
	return record.Disclosure{Trailers: trailers.lines, Description: desc.lines, CommitProse: prose.lines}
}

// splitTrailer returns a trailer line's lower-cased key and its value.
func splitTrailer(line string) (key, value string, ok bool) {
	m := trailerLine.FindStringSubmatch(line)
	if m == nil {
		return "", "", false
	}
	return strings.ToLower(m[1]), m[2], true
}

func keepTrailer(key, value string) bool {
	if broad.MatchString(key) {
		return true
	}
	return strings.HasSuffix(key, "-by") && (broad.MatchString(value) || byValue.MatchString(value))
}

// list is a de-duplicated list of candidates, in order of first appearance.
type list struct {
	lines []string
	seen  map[string]bool
}

func newList() *list {
	return &list{lines: []string{}, seen: map[string]bool{}}
}

func (l *list) add(line string) {
	line = cut(line, maxCandidate)
	if !l.seen[line] {
		l.seen[line] = true
		l.lines = append(l.lines, line)
	}
}

// cut keeps the first n characters of s.
func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
