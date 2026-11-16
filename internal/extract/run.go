package extract

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"

	"github.com/jhoblitt/ceph-dev-stats/internal/fetch"
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
)

// Config is one run's settings.
type Config struct {
	// CacheDir holds fetch's raw/, authors.json and meta.json.
	CacheDir string
	// DataDir holds the committed prs/, authors.json and meta.json.
	DataDir string
	// All re-derives the record of every cached pull request, including
	// those whose cache entry is older than their record, or as old and of
	// an older format.
	All bool
	// Logger receives progress; slog.Default() when nil.
	Logger *slog.Logger
}

// entryName is a cache entry's file name; anything else in raw/, such as a
// temporary file an interrupted write left behind, is not an entry.
var entryName = regexp.MustCompile(`^(\d+)\.json$`)

// Run upserts the records in cfg.DataDir from the cache in cfg.CacheDir.
// A cached pull request replaces its record when it was updated after the
// record, when it was updated at the same time and is in the current
// FormatVersion, or always with cfg.All. So an entry fetched again in a
// newer format re-derives its record, and an entry of an older format
// never strips what a newer one added. Every record's prior_prs is then
// recomputed, since a newly added pull request can come before others by
// the same author, and only the monthly files whose bytes change are
// rewritten. The cache's baselines are added to data/authors.json, and its
// meta, when it has one, becomes data/meta.json.
func Run(ctx context.Context, cfg Config) error {
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}
	numbers, err := cachedNumbers(cfg.CacheDir)
	if err != nil {
		return err
	}
	byNumber, replaced, odd, err := upsert(cfg, numbers)
	if err != nil {
		return err
	}
	if len(odd) > 0 {
		log.WarnContext(ctx, "event addresses without an event id",
			slog.Int("events", len(odd)),
			slog.String("example", odd[0]))
	}

	authors, cacheHasAuthors, err := mergeAuthors(cfg)
	if err != nil {
		return err
	}
	recs := slices.SortedFunc(maps.Values(byNumber), func(a, b record.Record) int { return cmp.Compare(a.Number, b.Number) })
	setPriorPRs(recs, authors)

	written, err := record.WriteRecords(cfg.DataDir, recs)
	if err != nil {
		return err
	}
	if cacheHasAuthors {
		if _, err := record.WriteAuthors(cfg.DataDir, authors); err != nil {
			return err
		}
	}
	if err := copyMeta(cfg); err != nil {
		return err
	}
	log.InfoContext(ctx, "extract finished",
		slog.Int("cached", len(numbers)),
		slog.Int("replaced", replaced),
		slog.Int("records", len(recs)),
		slog.Int("months_written", len(written)))
	return nil
}

// upsert reads the committed records and replaces each with its cached
// pull request's by the rule Run states. It returns the records by number, how many it replaced, and the
// event addresses of the replacements that held no event id.
func upsert(cfg Config, numbers []int) (byNumber map[int]record.Record, replaced int, odd []string, err error) {
	existing, err := record.ReadRecords(cfg.DataDir)
	if err != nil {
		return nil, 0, nil, err
	}
	byNumber = make(map[int]record.Record, len(existing)+len(numbers))
	for i := range existing {
		byNumber[existing[i].Number] = existing[i]
	}
	for _, n := range numbers {
		e, err := fetch.ReadEntry(cfg.CacheDir, n)
		if err != nil {
			return nil, 0, nil, err
		}
		if old, ok := byNumber[n]; ok && !cfg.All && !replaces(e, old) {
			continue
		}
		r, err := FromEntry(e)
		if err != nil {
			return nil, 0, nil, err
		}
		byNumber[n] = r
		replaced++
		odd = append(odd, oddAddresses(e)...)
	}
	return byNumber, replaced, odd, nil
}

// replaces reports whether entry e is newer than record old, or as new and
// in the current format.
func replaces(e fetch.Entry, old record.Record) bool {
	switch utc(e.UpdatedAt).Compare(old.Updated) {
	case 1:
		return true
	case 0:
		return e.FormatVersion >= fetch.FormatVersion
	default:
		return false
	}
}

// cachedNumbers lists the pull requests in the cache, in order.
func cachedNumbers(cacheDir string) ([]int, error) {
	dir := filepath.Join(cacheDir, fetch.RawDir)
	des, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("listing %s: %w", dir, err)
	}
	var numbers []int
	for _, de := range des {
		m := entryName.FindStringSubmatch(de.Name())
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[1])
		if err != nil {
			return nil, fmt.Errorf("listing %s: %w", dir, err)
		}
		numbers = append(numbers, n)
	}
	slices.Sort(numbers)
	return numbers, nil
}

// mergeAuthors is the committed baselines with the cache's added over
// them. A cache started afresh holds only the authors it has seen, so
// copying it alone would drop baselines the committed file already has.
// inCache is false when the cache has no authors.json.
func mergeAuthors(cfg Config) (authors map[string]int, inCache bool, err error) {
	authors, err = record.ReadAuthors(cfg.DataDir)
	if errors.Is(err, fs.ErrNotExist) {
		authors, err = map[string]int{}, nil
	}
	if err != nil {
		return nil, false, err
	}
	var cached map[string]int
	err = fetch.ReadJSON(filepath.Join(cfg.CacheDir, fetch.AuthorsFile), &cached)
	if errors.Is(err, fs.ErrNotExist) {
		return authors, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	maps.Copy(authors, cached)
	return authors, true, nil
}

// setPriorPRs sets each record's prior_prs: its author's baseline plus the
// author's records opened at or after the window start and before it. It
// stays nil before the window start and for an author with no baseline.
func setPriorPRs(recs []record.Record, baselines map[string]int) {
	order := make([]*record.Record, len(recs))
	for i := range recs {
		order[i] = &recs[i]
	}
	slices.SortFunc(order, func(a, b *record.Record) int {
		return cmp.Or(a.Created.Compare(b.Created), cmp.Compare(a.Number, b.Number))
	})
	inWindow := map[string]int{}
	for _, r := range order {
		r.PriorPRs = nil
		if r.Created.Before(fetch.WindowStart) {
			continue
		}
		if base, ok := baselines[r.Author.Login]; ok {
			r.PriorPRs = new(base + inWindow[r.Author.Login])
		}
		inWindow[r.Author.Login]++
	}
}

// copyMeta writes the cache's meta, when it has one, as data/meta.json.
func copyMeta(cfg Config) error {
	var m fetch.Meta
	err := fetch.ReadJSON(filepath.Join(cfg.CacheDir, fetch.MetaFile), &m)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = record.WriteMeta(cfg.DataDir, record.Meta{
		Repo:           fetch.Owner + "/" + fetch.Name,
		WindowStart:    fetch.WindowStart,
		FetchedThrough: utc(m.WalkStarted),
		GitHubCounts:   record.Counts{OpenedInWindow: m.OpenedInWindow, Open: m.Open},
	})
	return err
}
