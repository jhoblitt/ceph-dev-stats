package extract_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/jhoblitt/ceph-dev-stats/internal/extract"
	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// file is what a spec knows of a file under the data directory: its bytes,
// and its identity, which a rewrite through rename replaces.
type file struct {
	content string
	info    os.FileInfo
}

var _ = Describe("Run", func() {
	var cacheDir, dataDir string

	BeforeEach(func() {
		cacheDir = GinkgoT().TempDir()
		dataDir = GinkgoT().TempDir()
	})

	writeJSON := func(path string, v any) {
		GinkgoHelper()
		b, err := json.MarshalIndent(v, "", "  ")
		Expect(err).NotTo(HaveOccurred())
		Expect(os.MkdirAll(filepath.Dir(path), 0o750)).To(Succeed())
		Expect(os.WriteFile(path, b, 0o600)).To(Succeed())
	}

	cache := func(entries ...fetch.Entry) {
		GinkgoHelper()
		for _, e := range entries {
			writeJSON(filepath.Join(cacheDir, fetch.RawDir, strconv.Itoa(e.Number)+".json"), e)
		}
	}

	run := func() {
		GinkgoHelper()
		Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: quiet()})).To(Succeed())
	}

	files := func() map[string]file {
		GinkgoHelper()
		out := map[string]file{}
		Expect(filepath.WalkDir(dataDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			info, err := os.Stat(path)
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(dataDir, path)
			out[rel] = file{content: string(b), info: info}
			return err
		})).To(Succeed())
		return out
	}

	// rewritten lists the files of after that are new or were replaced
	// since before.
	rewritten := func(before, after map[string]file) []string {
		var out []string
		for name, a := range after {
			if b, ok := before[name]; !ok || !os.SameFile(a.info, b.info) {
				out = append(out, name)
			}
		}
		return out
	}

	records := func() map[int]record.Record {
		GinkgoHelper()
		recs, err := record.ReadRecords(dataDir)
		Expect(err).NotTo(HaveOccurred())
		out := map[int]record.Record{}
		for _, r := range recs {
			out[r.Number] = r
		}
		return out
	}

	day := func(month time.Month, d int) time.Time {
		return time.Date(2026, month, d, 12, 0, 0, 0, time.UTC)
	}

	It("records every cached PR by month, and copies the cache's authors and meta", func() {
		cache(fixture("backport"), fixture("draft-ready"), fixture("ghost"), fixture("reopened"))
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]int{"erin-example": 0, "alice-example": 12})
		writeJSON(filepath.Join(cacheDir, "meta.json"), fetch.Meta{
			WalkStarted: time.Date(2026, 11, 15, 12, 0, 0, 123_000_000, time.UTC), OpenedInWindow: 4985, Open: 2019,
		})

		run()

		Expect(files()).To(HaveLen(6))
		Expect(records()).To(HaveLen(4))
		Expect(files()).To(HaveKey(filepath.Join(record.PRsDir, "2026-05.jsonl")))
		Expect(files()).To(HaveKey(filepath.Join(record.PRsDir, "2026-06.jsonl")))
		Expect(files()).To(HaveKey(filepath.Join(record.PRsDir, "2026-07.jsonl")))
		Expect(files()).To(HaveKey(filepath.Join(record.PRsDir, "2026-08.jsonl")))
		Expect(record.ReadAuthors(dataDir)).To(Equal(map[string]int{"alice-example": 12, "erin-example": 0}))
		Expect(files()[record.MetaFile].content).To(Equal(`{
  "repo": "ceph/ceph",
  "window_start": "2026-05-15T00:00:00Z",
  "fetched_through": "2026-11-15T12:00:00Z",
  "github_counts": {
    "opened_in_window": 4985,
    "open": 2019
  }
}
`))
	})

	It("writes nothing with an empty cache", func() {
		run()
		Expect(files()).To(BeEmpty())
	})

	It("changes no file with an empty cache over existing data", func() {
		cache(fixture("backport"), fixture("draft-ready"))
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]int{"alice-example": 12})
		writeJSON(filepath.Join(cacheDir, "meta.json"), fetch.Meta{WalkStarted: day(11, 15)})
		run()
		before := files()

		cacheDir = GinkgoT().TempDir()
		run()

		Expect(rewritten(before, files())).To(BeEmpty())
		Expect(files()).To(HaveLen(len(before)))
	})

	It("writes identical bytes and touches no file on a second run", func() {
		cache(fixture("backport"), fixture("draft-ready"), fixture("reopened"), fixture("force-pushed"), fixture("late-commits"), fixture("ghost"))
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]int{"alice-example": 12})
		writeJSON(filepath.Join(cacheDir, "meta.json"), fetch.Meta{WalkStarted: day(11, 15)})
		run()
		before := files()

		run()
		after := files()
		Expect(rewritten(before, after)).To(BeEmpty())
		Expect(after).To(HaveLen(len(before)))
		for name, f := range before {
			Expect(after[name].content).To(Equal(f.content), "file %s", name)
		}
	})

	It("rewrites exactly one monthly file after one PR changed", func() {
		changed := fixture("draft-ready")
		cache(fixture("backport"), changed, fixture("reopened"), fixture("force-pushed"))
		run()
		before := files()

		changed.UpdatedAt = changed.UpdatedAt.Add(time.Hour)
		changed.State = "MERGED"
		cache(changed)
		run()

		Expect(rewritten(before, files())).To(ConsistOf(filepath.Join(record.PRsDir, "2026-07.jsonl")))
		Expect(records()[changed.Number].State).To(Equal(record.StateMerged))
	})

	It("re-derives a record from a current-format cache entry at the same updatedAt", func() {
		e := fixture("force-pushed")
		e.FormatVersion = fetch.FormatVersion
		cache(e)
		run()

		e.Title = "a title changed without moving updatedAt"
		cache(e)
		run()

		Expect(records()[e.Number].Title).To(Equal("a title changed without moving updatedAt"))
	})

	It("keeps a record whose cache entry is older, or as old and of an older format, and warns once with their count", func() {
		older := fixture("force-pushed")
		oldFormat := fixture("draft-ready")
		oldFormat.FormatVersion = fetch.FormatVersion
		cache(older, oldFormat)
		run()
		before := records()

		older.UpdatedAt = older.UpdatedAt.Add(-time.Hour)
		older.Title = "a title from an older entry"
		oldFormat.FormatVersion = fetch.FormatVersion - 1
		oldFormat.Title = "a title from an entry of an older format"
		cache(older, oldFormat)
		var logs bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&logs, nil))
		Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: logger})).To(Succeed())

		Expect(records()).To(Equal(before))
		var warnings []map[string]any
		for line := range bytes.Lines(logs.Bytes()) {
			var m map[string]any
			Expect(json.Unmarshal(line, &m)).To(Succeed(), "log line %s", line)
			if m["level"] == "WARN" {
				warnings = append(warnings, m)
			}
		}
		Expect(warnings).To(HaveExactElements(And(
			HaveKeyWithValue("msg", "cache entries older than their records"),
			HaveKeyWithValue("entries", 2.0),
			HaveKeyWithValue("example", float64(min(older.Number, oldFormat.Number))),
		)), "log:\n%s", logs.String())
	})

	It("counts an author's earlier PRs in the window on top of their baseline", func() {
		cache(
			entry(10, "kim", day(4, 1)),
			entry(20, "kim", day(6, 1)),
			entry(21, "lee", day(6, 2)),
			entry(30, "kim", day(7, 1)),
			entry(40, "kim", day(8, 1)),
		)
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]int{"kim": 4, "lee": 0})

		run()

		got := records()
		Expect(got[10].PriorPRs).To(BeNil(), "PR opened before the window")
		Expect(got[20].PriorPRs).To(HaveValue(Equal(4)), "kim's first PR in the window")
		Expect(got[30].PriorPRs).To(HaveValue(Equal(5)), "kim's second PR in the window")
		Expect(got[40].PriorPRs).To(HaveValue(Equal(6)), "kim's third PR in the window")
		Expect(got[21].PriorPRs).To(HaveValue(Equal(0)), "lee's first PR")
	})

	It("counts a PR opened exactly at the window start as in the window", func() {
		cache(entry(1, "kim", fetch.WindowStart))
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]int{"kim": 4})

		run()

		Expect(records()[1].PriorPRs).To(HaveValue(Equal(4)))
	})

	It("recomputes prior_prs over every record when a backfill adds an earlier PR", func() {
		cache(entry(30, "kim", day(7, 1)))
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]int{"kim": 4})
		run()
		Expect(records()[30].PriorPRs).To(HaveValue(Equal(4)))
		before := files()

		cacheDir = GinkgoT().TempDir()
		cache(entry(20, "kim", day(6, 1)))
		run()

		Expect(records()[30].PriorPRs).To(HaveValue(Equal(5)))
		Expect(rewritten(before, files())).To(ConsistOf(
			filepath.Join(record.PRsDir, "2026-06.jsonl"),
			filepath.Join(record.PRsDir, "2026-07.jsonl"),
		))
	})

	It("leaves prior_prs null for an author with no baseline", func() {
		ghost := entry(1, "ghost", day(6, 1))
		ghost.Author = nil
		cache(ghost, entry(2, "dependabot", day(6, 2)))
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]int{"kim": 4})

		run()

		Expect(records()[1].Author).To(Equal(record.Actor{Login: fetch.GhostLogin}))
		Expect(records()[1].PriorPRs).To(BeNil())
		Expect(records()[2].PriorPRs).To(BeNil())
	})

	It("adds the cache's baselines to the committed ones", func() {
		Expect(record.WriteAuthors(dataDir, map[string]int{"kim": 4, "lee": 1})).To(BeTrue())
		writeJSON(filepath.Join(cacheDir, "authors.json"), map[string]int{"lee": 2, "max": 7})

		run()

		Expect(record.ReadAuthors(dataDir)).To(Equal(map[string]int{"kim": 4, "lee": 2, "max": 7}))
	})

	It("leaves the committed meta alone when the cache has none", func() {
		meta := record.Meta{Repo: "ceph/ceph", WindowStart: fetch.WindowStart, FetchedThrough: day(11, 1)}
		Expect(record.WriteMeta(dataDir, meta)).To(BeTrue())
		cache(fixture("ghost"))

		run()

		Expect(record.ReadMeta(dataDir)).To(Equal(meta))
	})

	It("reads only <number>.json entries from the cache", func() {
		cache(fixture("ghost"))
		Expect(os.WriteFile(filepath.Join(cacheDir, fetch.RawDir, ".70007.json.123.tmp"), []byte("{"), 0o600)).To(Succeed())
		Expect(os.WriteFile(filepath.Join(cacheDir, fetch.RawDir, "notes.txt"), []byte("{"), 0o600)).To(Succeed())

		run()

		Expect(records()).To(HaveLen(1))
	})

	It("gives the count of withheld lines by a well-formed domain, other or no address in its closing log line, and no address or name", func() {
		e := entry(1, "alice", day(6, 1))
		e.Commits = []fetch.Commit{{
			AuthoredDate: day(6, 1), CommittedDate: day(6, 1),
			Message: "rgw: fix\n\nCo-authored-by: Claude Dupont <claude.dupont@example.com>\nCo-authored-by: Claude <noreply@anthropic.com>\nCo-authored-by: Claude Martin\n",
		}}
		e.Body = "Original-Author: Claude X <x@y>\nCo-authored-by: Ana Smith <ana.smith@Example.com>, Claude\nGenerated with Claude, ask jo@exa_mple.com\n"
		cache(e)
		var logs bytes.Buffer
		logger := slog.New(slog.NewJSONHandler(&logs, nil))

		Expect(extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: logger})).To(Succeed())

		var finished []map[string]any
		for line := range bytes.Lines(logs.Bytes()) {
			var m map[string]any
			Expect(json.Unmarshal(line, &m)).To(Succeed(), "log line %s", line)
			if m["msg"] == "extract finished" {
				finished = append(finished, m)
			}
		}
		Expect(finished).To(HaveExactElements(HaveKeyWithValue("withheld_by_domain", map[string]any{"example.com": 2.0, "y": 1.0, "other": 1.0, "no address": 1.0})), "log:\n%s", logs.String())
		for _, s := range []string{"@", "claude.dupont", "Dupont", "Ana", "Smith", "Martin", "exa_mple"} {
			Expect(logs.String()).NotTo(ContainSubstring(s), "log:\n%s", logs.String())
		}
		Expect(records()[1].Disclosure.Trailers).To(Equal([]string{"Co-authored-by: Claude <noreply@anthropic.com>"}))
	})

	It("is an error naming the entry when one cannot be read", func() {
		path := filepath.Join(cacheDir, fetch.RawDir, "5.json")
		Expect(os.MkdirAll(filepath.Dir(path), 0o750)).To(Succeed())
		Expect(os.WriteFile(path, []byte("{"), 0o600)).To(Succeed())

		err := extract.Run(context.Background(), extract.Config{CacheDir: cacheDir, DataDir: dataDir, Logger: quiet()})

		Expect(err).To(MatchError(ContainSubstring(path)))
		Expect(files()).To(BeEmpty())
	})
})
