package fetch

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// GhostLogin is the login a null author is stored under: GitHub returns a
// deleted account as null, and shows it as its placeholder user "ghost".
const GhostLogin = "ghost"

// FormatVersion is the version of the entry format this package writes. An
// entry of an older version is fetched again whatever its updatedAt, so a
// change to what an entry holds reaches every cached pull request.
const FormatVersion = 1

// Actor is a pull request, comment or review author.
type Actor struct {
	Login    string `json:"login"`
	Typename string `json:"__typename"`
}

// Label is a label on a pull request.
type Label struct {
	Name string `json:"name"`
}

// Commit is one of a pull request's commits.
type Commit struct {
	OID           string    `json:"oid"`
	AuthoredDate  time.Time `json:"authoredDate"`
	CommittedDate time.Time `json:"committedDate"`
	Message       string    `json:"message"`
}

// Comment is a conversation comment on a pull request. DatabaseID is
// GitHub's fullDatabaseId, a BigInt kept as the JSON string GitHub sends;
// it is zero when GitHub gave none.
type Comment struct {
	DatabaseID int64     `json:"fullDatabaseId,string"`
	CreatedAt  time.Time `json:"createdAt"`
	Body       string    `json:"body"`
	Author     *Actor    `json:"author"`
}

// Review is a review on a pull request. SubmittedAt is nil for a pending
// review. DatabaseID is as Comment's.
type Review struct {
	DatabaseID  int64      `json:"fullDatabaseId,string"`
	SubmittedAt *time.Time `json:"submittedAt"`
	State       string     `json:"state"`
	Author      *Actor     `json:"author"`
}

// Event is a timeline event; Typename tells the kinds apart, such as
// ClosedEvent or HeadRefForcePushedEvent.
type Event struct {
	Typename  string    `json:"__typename"`
	CreatedAt time.Time `json:"createdAt"`
	// URL is the event's address on GitHub, ending in #event-<id>. A
	// ReopenedEvent has none.
	URL string `json:"url,omitzero"`
	// Commit is a MergedEvent's merge commit.
	Commit *CommitRef `json:"commit,omitzero"`
	// BeforeCommit and AfterCommit are a HeadRefForcePushedEvent's head
	// before and after the push. GitHub gives null for a commit it no
	// longer has.
	BeforeCommit *CommitRef `json:"beforeCommit,omitzero"`
	AfterCommit  *CommitRef `json:"afterCommit,omitzero"`
}

// CommitRef names a commit by its SHA.
type CommitRef struct {
	OID string `json:"oid"`
}

// Entry is one cached pull request, .cache/raw/<number>.json: GitHub's node
// with every nested connection paged to the end and flattened to a list,
// plus the start time of the walk that fetched it. In the cache every
// Author is non-nil.
type Entry struct {
	Number            int        `json:"number"`
	Title             string     `json:"title"`
	Body              string     `json:"body"`
	State             string     `json:"state"`
	IsDraft           bool       `json:"isDraft"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	ClosedAt          *time.Time `json:"closedAt"`
	MergedAt          *time.Time `json:"mergedAt"`
	BaseRefName       string     `json:"baseRefName"`
	Additions         int        `json:"additions"`
	Deletions         int        `json:"deletions"`
	ChangedFiles      int        `json:"changedFiles"`
	AuthorAssociation string     `json:"authorAssociation"`
	Author            *Actor     `json:"author"`
	Labels            []Label    `json:"labels"`
	Commits           []Commit   `json:"commits"`
	Comments          []Comment  `json:"comments"`
	Reviews           []Review   `json:"reviews"`
	TimelineItems     []Event    `json:"timelineItems"`
	FetchedAt         time.Time  `json:"fetchedAt"`
	// FormatVersion is the FormatVersion of the fetch that wrote the
	// entry, and zero in an entry written before entries carried one.
	FormatVersion int `json:"formatVersion"`
}

// Meta is .cache/meta.json, written at the end of a complete walk.
type Meta struct {
	WalkStarted    time.Time `json:"walk_started"`
	OpenedInWindow int       `json:"opened_in_window"`
	Open           int       `json:"open"`
}

// Names under a cache directory.
const (
	// RawDir holds the entries.
	RawDir = "raw"
	// AuthorsFile maps each author to their pull requests opened before
	// the window start.
	AuthorsFile = "authors.json"
	// MetaFile holds Meta.
	MetaFile = "meta.json"
)

// ReadEntry reads the cached entry for pull request number. A missing entry
// is an error that matches fs.ErrNotExist.
func ReadEntry(cacheDir string, number int) (Entry, error) {
	return readEntryFile(entryPath(cacheDir, number))
}

func entryPath(cacheDir string, number int) string {
	return filepath.Join(cacheDir, RawDir, strconv.Itoa(number)+".json")
}

func readEntryFile(path string) (Entry, error) {
	var e Entry
	if err := ReadJSON(path, &e); err != nil {
		return Entry{}, err
	}
	return e, nil
}

// cachedEntries returns the paths of every entry in the cache, skipping
// the temporary files an interrupted write leaves behind.
func cachedEntries(cacheDir string) ([]string, error) {
	dir := filepath.Join(cacheDir, RawDir)
	des, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("listing %s: %w", dir, err)
	}
	var paths []string
	for _, de := range des {
		if name := de.Name(); strings.HasSuffix(name, ".json") && !strings.HasPrefix(name, ".") {
			paths = append(paths, filepath.Join(dir, name))
		}
	}
	return paths, nil
}

// staleEntries counts the cache's entries written in an older FormatVersion.
func staleEntries(cacheDir string) (int, error) {
	paths, err := cachedEntries(cacheDir)
	if err != nil {
		return 0, err
	}
	stale := 0
	for _, p := range paths {
		var v struct {
			FormatVersion int `json:"formatVersion"`
		}
		if err := ReadJSON(p, &v); err != nil {
			return 0, err
		}
		if v.FormatVersion < FormatVersion {
			stale++
		}
	}
	return stale, nil
}

// ReadJSON decodes the JSON file at path into v. A missing file is an error
// that matches fs.ErrNotExist.
func ReadJSON(path string, v any) error {
	b, err := os.ReadFile(path) //nolint:gosec // the cache and data directories are the operator's to name
	if err != nil {
		return fmt.Errorf("reading %s: %w", path, err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("decoding %s: %w", path, err)
	}
	return nil
}

// writeJSON replaces path with v through a temporary file and a rename, so
// a reader never sees a partial file.
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding %s: %w", path, err)
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	if err = replace(tmp, append(b, '\n'), path); err != nil {
		return fmt.Errorf("writing %s: %w", path, errors.Join(err, os.Remove(tmp.Name())))
	}
	return nil
}

// replace fills tmp with b and renames it to path.
func replace(tmp *os.File, b []byte, path string) error {
	if _, err := tmp.Write(b); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Sync(); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
