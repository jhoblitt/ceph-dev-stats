package extract_test

import (
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/extract"
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// none is a Disclosure with no candidates.
func none() record.Disclosure {
	return record.Disclosure{Trailers: []string{}, Description: []string{}, CommitProse: []string{}}
}

func trailer(s string) record.Disclosure {
	d := none()
	d.Trailers = []string{s}
	return d
}

func prose(s string) record.Disclosure {
	d := none()
	d.CommitProse = []string{s}
	return d
}

func description(s string) record.Disclosure {
	d := none()
	d.Description = []string{s}
	return d
}

var _ = Describe("Candidates", func() {
	DescribeTable("a commit message line",
		func(line string, want record.Disclosure) {
			msg := "rgw: subject line\n\nSome body text.\n\n" + line + "\nSigned-off-by: Jane Roe <jane@example.com>\n"
			Expect(extract.Candidates([]string{msg}, "")).To(Equal(want), "line %q", line)
		},

		// Every trailer spelling in the design's Measurements.
		Entry("Assisted-by naming Claude Code", "Assisted-by: Claude Code", trailer("Assisted-by: Claude Code")),
		Entry("Assisted-by with a tool:model value", "Assisted-by: claude-code:claude-opus-4-6", trailer("Assisted-by: claude-code:claude-opus-4-6")),
		Entry("Assisted-by naming only an LLM", "Assisted-by: LLM", trailer("Assisted-by: LLM")),
		Entry("Assisted-by naming IBM Bob with a version", "Assisted-by: IBM Bob 2.3.0", trailer("Assisted-by: IBM Bob 2.3.0")),
		Entry("Assisted-by naming Codex and GPT", "Assisted-by: Codex (GPT-6)", trailer("Assisted-by: Codex (GPT-6)")),
		Entry("Assisted-by naming Gemini", "Assisted-by: Gemini", trailer("Assisted-by: Gemini")),
		Entry("Assisted-by naming Cursor with its address", "Assisted-by: Cursor <cursoragent@cursor.com>", trailer("Assisted-by: Cursor <cursoragent@cursor.com>")),
		Entry("Assisted-by in any case, naming a tool not on the list", "ASSISTED-BY: Tabnine", trailer("ASSISTED-BY: Tabnine")),
		Entry("the Assistant-By near miss", "Assistant-By: Claude", trailer("Assistant-By: Claude")),
		Entry("the Claude-Session near miss, kept by its key", "Claude-Session: 01JABCDEF", trailer("Claude-Session: 01JABCDEF")),
		Entry("Co-authored-by naming Claude", "Co-authored-by: Claude <noreply@anthropic.com>", trailer("Co-authored-by: Claude <noreply@anthropic.com>")),
		Entry("Co-authored-by naming Copilot", "Co-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>", trailer("Co-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>")),
		Entry("a -by trailer whose value is only Cursor", "Co-authored-by: Cursor", trailer("Co-authored-by: Cursor")),
		Entry("a trailer with leading whitespace, trimmed", "   Assisted-by: Gemini CLI  ", trailer("Assisted-by: Gemini CLI")),

		// People and never-kept keys.
		Entry("Co-authored-by naming a person", "Co-authored-by: Ana Smith <ana@example.com>", none()),
		Entry("Signed-off-by naming a person called Claude", "Signed-off-by: Claude Dupont <c@example.com>", none()),
		Entry("Reviewed-by naming Copilot", "Reviewed-by: Copilot", none()),
		Entry("Link to an assistant's site", "Link: https://claude.ai/share/0000", none()),
		Entry("Fixes naming a tracker issue", "Fixes: https://tracker.ceph.com/issues/12345", none()),

		// Prose, and trailer-shaped lines that are not kept as trailers.
		Entry("the prose near miss", "Assisted by Claude Opus-5.5", prose("Assisted by Claude Opus-5.5")),
		Entry("a tool's name alone, kept for a later verdict", "Address Copilot review comments", prose("Address Copilot review comments")),
		Entry("a non -by trailer whose value matches", "Model: claude-opus-5-5", prose("Model: claude-opus-5-5")),
		Entry("a component-prefixed subject naming AI", "doc: say how AI tools may be used", prose("doc: say how AI tools may be used")),
		Entry("LLM as a word", "the llm suggested this loop", prose("the llm suggested this loop")),
		Entry("GPT followed by a digit", "compare against gpt4o output", prose("compare against gpt4o output")),
		Entry("GPT as a word, generous on purpose", "probe the GPT partition table", prose("probe the GPT partition table")),
		Entry("Cursor's address in prose", "drafted with cursoragent@cursor.com", prose("drafted with cursoragent@cursor.com")),

		// False friends.
		Entry("a RADOS cursor function", "Use list_nobjects_get_cursor() to resume listing", none()),
		Entry("cursor as a plain word", "move the cursor past the last key", none()),
		Entry("ai inside lower-case words", "maintain the aio completion path", none()),
		Entry("AI only as part of a longer word", "AIO and RAID paths are untouched", none()),
		Entry("gpt inside a word", "gptfdisk is not installed", none()),
		Entry("llm inside a word", "fillmore street", none()),
		Entry("aider inside a word", "the raider thread stops at shutdown", none()),
		Entry("anthropic inside a word", "a philanthropic default for the cache size", none()),
		Entry("generated with inside regenerated without", "the unit file is regenerated without the stale mount", none()),
		Entry("aider as a word", "drafted with aider", prose("drafted with aider")),
		Entry("Anthropic as a word", "an Anthropic model wrote the first draft", prose("an Anthropic model wrote the first draft")),
		Entry("re-generated with, generous on purpose", "keys are re-generated with the new cipher", prose("keys are re-generated with the new cipher")),
	)

	DescribeTable("a PR description line",
		func(line string, want record.Disclosure) {
			body := "## Description\r\n\r\n" + line + "\r\n\r\n## Checklist\r\n- [x] Tracker\r\n"
			Expect(extract.Candidates(nil, body)).To(Equal(want), "line %q", line)
		},

		// Every description form in the design's Measurements.
		Entry("Assisted by, in prose", "Assisted by Claude Code (Opus 5.5)", description("Assisted by Claude Code (Opus 5.5)")),
		Entry("Generated with", "🤖 Generated with [Claude Code](https://claude.com/claude-code)", description("🤖 Generated with [Claude Code](https://claude.com/claude-code)")),
		Entry("Raised by", "🤖 Raised by [Claude Code](https://claude.com/claude-code)", description("🤖 Raised by [Claude Code](https://claude.com/claude-code)")),
		Entry("a Disclosure: line", "Disclosure: parts of this were prepared with the help of Claude Code", description("Disclosure: parts of this were prepared with the help of Claude Code")),
		Entry("an LLM, in a sentence", "I made this fix with an LLM", description("I made this fix with an LLM")),
		Entry("a tool's name alone, kept for a later verdict", "This adds a Copilot review skill", description("This adds a Copilot review skill")),
		Entry("an Assisted-by trailer pasted into the description", "Assisted-by: Gemini", description("Assisted-by: Gemini")),

		// False friends.
		Entry("a never-kept trailer naming a person called Claude", "Signed-off-by: Claude Dupont <c@example.com>", none()),
		Entry("a RADOS cursor function", "calls list_nobjects_get_cursor() once per page", none()),
	)

	It("finds trailers above a backport's cherry-pick line and Conflicts paragraph", func() {
		msg := "osd: fix a leak\n\n" +
			"Free the buffer on the error path.\n\n" +
			"Fixes: https://tracker.ceph.com/issues/12345\n" +
			"Assisted-by: Claude Code\n" +
			"Signed-off-by: Jane Roe <jane@example.com>\n" +
			"(cherry picked from commit 0123456789abcdef0123456789abcdef01234567)\n\n" +
			"Conflicts:\n" +
			"\tsrc/osd/PrimaryLogPG.cc\n" +
			"\t- kept the squid include order\n"

		Expect(extract.Candidates([]string{msg}, "")).To(Equal(trailer("Assisted-by: Claude Code")))
	})

	It("de-duplicates each list in order of first appearance across commits", func() {
		msgs := []string{
			"a: one\n\nAssisted-by: Gemini\nAssisted-by: Claude Code\n",
			"a: two\n\nAddress Copilot review comments\n\nAssisted-by: Claude Code\n",
			"a: three\n\nAddress Copilot review comments\nAssisted-by: Gemini\nAssisted-by: LLM\n",
		}
		body := "Generated with Claude Code\nsome text\nGenerated with Claude Code\n"

		Expect(extract.Candidates(msgs, body)).To(Equal(record.Disclosure{
			Trailers:    []string{"Assisted-by: Gemini", "Assisted-by: Claude Code", "Assisted-by: LLM"},
			Description: []string{"Generated with Claude Code"},
			CommitProse: []string{"Address Copilot review comments"},
		}))
	})

	It("cuts a candidate at 200 characters, counting characters rather than bytes", func() {
		long := "Assisted by Claude: " + strings.Repeat("é", 300)

		got := extract.Candidates(nil, long)

		Expect(got.Description).To(HaveLen(1))
		Expect([]rune(got.Description[0])).To(HaveLen(200))
		Expect(got.Description[0]).To(HavePrefix("Assisted by Claude: éé"))
	})

	It("has no candidates, and empty lists rather than null, for text with none", func() {
		Expect(extract.Candidates([]string{"rgw: fix\n\nSigned-off-by: Jane Roe <jane@example.com>"}, "")).To(Equal(none()))
	})
})
