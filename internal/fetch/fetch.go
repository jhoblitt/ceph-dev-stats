// Package fetch walks ceph/ceph pull requests through GitHub's GraphQL API
// into the local raw cache.
package fetch

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"path/filepath"
	"slices"
	"strconv"
	"time"

	"github.com/jhoblitt/ceph-dev-stats/internal/ghapi"
)

// The repository the walk reads.
const (
	Owner = "ceph"
	Name  = "ceph"
)

// WindowStart is the start of the data window. It never moves.
var WindowStart = time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)

// Defaults for Config's zero values.
const (
	DefaultPageSize       = 25
	DefaultNestedPageSize = 50
	// authorsPerRequest is how many aliased searches one request carries.
	authorsPerRequest = 25
)

// Config is one walk's settings.
type Config struct {
	// CacheDir holds raw/, authors.json and meta.json.
	CacheDir string
	// Since ends the walk over recently updated pull requests at the first
	// one updated before it.
	Since time.Time
	// PageSize is the number of pull requests asked for at first; it
	// halves when a page repeatedly fails. DefaultPageSize when zero.
	PageSize int
	// NestedPageSize is the number of commits, comments, reviews, events
	// or labels asked for per page. DefaultNestedPageSize when zero.
	NestedPageSize int
	// Logger receives progress; slog.Default() when nil.
	Logger *slog.Logger
	// Now gives the walk's start time; time.Now when nil.
	Now func() time.Time
}

type walker struct {
	client   *ghapi.Client
	cfg      Config
	log      *slog.Logger
	started  time.Time
	pageSize int
}

// Run walks pull requests into cfg.CacheDir in three phases: those updated
// since cfg.Since, most recent first; every open one; then the prior-PR
// count of each author not yet in authors.json. It ends by writing GitHub's
// counts to meta.json. A pull request already cached at the listed
// updatedAt is not fetched again, so a run that stops early can be
// repeated.
func Run(ctx context.Context, client *ghapi.Client, cfg Config) error {
	if cfg.PageSize == 0 {
		cfg.PageSize = DefaultPageSize
	}
	if cfg.NestedPageSize == 0 {
		cfg.NestedPageSize = DefaultNestedPageSize
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	w := &walker{client: client, cfg: cfg, log: cfg.Logger, started: cfg.Now().UTC(), pageSize: cfg.PageSize}
	w.log.InfoContext(ctx, "walk started",
		slog.Time("since", cfg.Since),
		slog.String("cache_dir", cfg.CacheDir))

	if err := w.walk(ctx, "updated", nil, cfg.Since); err != nil {
		return err
	}
	if err := w.walk(ctx, "open", []string{"OPEN"}, time.Time{}); err != nil {
		return err
	}
	if err := w.baselines(ctx); err != nil {
		return err
	}
	meta, err := w.counts(ctx)
	if err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(cfg.CacheDir, "meta.json"), meta); err != nil {
		return err
	}
	w.log.InfoContext(ctx, "walk finished",
		slog.Int("opened_in_window", meta.OpenedInWindow),
		slog.Int("open", meta.Open))
	return nil
}

// DefaultSince is where a walk starts when no --since is given: a day
// before the last walk recorded in dataDir/meta.json, so updates that
// slipped past that walk are picked up, or the window start when there is
// no meta yet.
func DefaultSince(dataDir string) (time.Time, error) {
	path := filepath.Join(dataDir, "meta.json")
	var meta struct {
		FetchedThrough time.Time `json:"fetched_through"`
	}
	err := readJSON(path, &meta)
	if errors.Is(err, fs.ErrNotExist) {
		return WindowStart, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	if meta.FetchedThrough.IsZero() {
		return time.Time{}, fmt.Errorf("%s has no fetched_through", path)
	}
	return meta.FetchedThrough.UTC().Add(-24 * time.Hour), nil
}

type pageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

type connection[T any] struct {
	PageInfo pageInfo `json:"pageInfo"`
	Nodes    []T      `json:"nodes"`
}

type commitNode struct {
	Commit Commit `json:"commit"`
}

// prNode is a listed pull request. Its connection fields shadow Entry's
// lists when decoding.
type prNode struct {
	Entry
	Labels        connection[Label]      `json:"labels"`
	Commits       connection[commitNode] `json:"commits"`
	Comments      connection[Comment]    `json:"comments"`
	Reviews       connection[Review]     `json:"reviews"`
	TimelineItems connection[Event]      `json:"timelineItems"`
}

// walk lists pull requests in states (all when nil) from the most recently
// updated, storing each, until the first one updated before since.
func (w *walker) walk(ctx context.Context, phase string, states []string, since time.Time) error {
	var after string
	fetched, skipped := 0, 0
	for page := 1; ; page++ {
		conn, err := w.listPage(ctx, states, after)
		if err != nil {
			return fmt.Errorf("listing %s pull requests: %w", phase, err)
		}
		for i := range conn.Nodes {
			n := &conn.Nodes[i]
			if n.UpdatedAt.Before(since) {
				w.log.InfoContext(ctx, "reached since",
					slog.String("phase", phase),
					slog.Int("fetched", fetched),
					slog.Int("skipped", skipped))
				return nil
			}
			stored, err := w.store(ctx, n)
			if err != nil {
				return err
			}
			if stored {
				fetched++
			} else {
				skipped++
			}
		}
		w.log.InfoContext(ctx, "listed page",
			slog.String("phase", phase),
			slog.Int("page", page),
			slog.Int("page_size", w.pageSize),
			slog.Int("fetched", fetched),
			slog.Int("skipped", skipped))
		if !conn.PageInfo.HasNextPage {
			return nil
		}
		after = conn.PageInfo.EndCursor
	}
}

// listPage asks for one page, halving the page size each time GitHub gives
// no usable answer, down to one pull request.
func (w *walker) listPage(ctx context.Context, states []string, after string) (connection[prNode], error) {
	for {
		vars := map[string]any{
			"owner": Owner, "name": Name,
			"first": w.pageSize, "nested": w.cfg.NestedPageSize,
		}
		if after != "" {
			vars["after"] = after
		}
		if states != nil {
			vars["states"] = states
		}
		var resp struct {
			Repository struct {
				PullRequests connection[prNode] `json:"pullRequests"`
			} `json:"repository"`
		}
		err := w.client.Do(ctx, ghapi.PullRequests, vars, &resp)
		if errors.Is(err, ghapi.ErrUnavailable) && w.pageSize > 1 {
			w.pageSize /= 2
			w.log.WarnContext(ctx, "halving page size",
				slog.Int("page_size", w.pageSize),
				slog.String("error", err.Error()))
			continue
		}
		return resp.Repository.PullRequests, err
	}
}

// store fetches the rest of n's connections and caches it, unless the
// cache already holds it at the same or a later updatedAt.
func (w *walker) store(ctx context.Context, n *prNode) (bool, error) {
	cached, err := ReadEntry(w.cfg.CacheDir, n.Number)
	switch {
	case err == nil && !n.UpdatedAt.After(cached.UpdatedAt):
		return false, nil
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return false, err
	}

	e := n.Entry
	if e.Labels, err = rest(ctx, w, n.Number, ghapi.Labels, n.Labels); err != nil {
		return false, err
	}
	commits, err := rest(ctx, w, n.Number, ghapi.Commits, n.Commits)
	if err != nil {
		return false, err
	}
	e.Commits = make([]Commit, len(commits))
	for i, c := range commits {
		e.Commits[i] = c.Commit
	}
	if e.Comments, err = rest(ctx, w, n.Number, ghapi.Comments, n.Comments); err != nil {
		return false, err
	}
	if e.Reviews, err = rest(ctx, w, n.Number, ghapi.Reviews, n.Reviews); err != nil {
		return false, err
	}
	if e.TimelineItems, err = rest(ctx, w, n.Number, ghapi.TimelineItems, n.TimelineItems); err != nil {
		return false, err
	}

	e.Author = orGhost(e.Author)
	for i := range e.Comments {
		e.Comments[i].Author = orGhost(e.Comments[i].Author)
	}
	for i := range e.Reviews {
		e.Reviews[i].Author = orGhost(e.Reviews[i].Author)
	}
	e.FetchedAt = w.started

	if err := writeJSON(entryPath(w.cfg.CacheDir, e.Number), e); err != nil {
		return false, err
	}
	w.log.DebugContext(ctx, "cached pull request",
		slog.Int("number", e.Number),
		slog.Time("updated_at", e.UpdatedAt))
	return true, nil
}

// rest returns first's nodes followed by every later page of connection c
// of pull request number.
func rest[T any](ctx context.Context, w *walker, number int, c ghapi.Connection, first connection[T]) ([]T, error) {
	nodes := first.Nodes
	info := first.PageInfo
	for info.HasNextPage {
		var resp struct {
			Repository struct {
				PullRequest map[string]connection[T] `json:"pullRequest"`
			} `json:"repository"`
		}
		vars := map[string]any{
			"owner": Owner, "name": Name, "number": number,
			"first": w.cfg.NestedPageSize, "after": info.EndCursor,
		}
		if err := w.client.Do(ctx, ghapi.ConnectionPage(c), vars, &resp); err != nil {
			return nil, fmt.Errorf("paging %s of pull request %d: %w", c, number, err)
		}
		page := resp.Repository.PullRequest[string(c)]
		nodes = append(nodes, page.Nodes...)
		info = page.PageInfo
	}
	return nodes, nil
}

func orGhost(a *Actor) *Actor {
	if a == nil {
		return &Actor{Login: GhostLogin, Typename: "User"}
	}
	return a
}

// baselines records, for each human author in the cache not yet in
// authors.json, how many pull requests they opened before the window.
func (w *walker) baselines(ctx context.Context) error {
	path := filepath.Join(w.cfg.CacheDir, "authors.json")
	known := map[string]int{}
	if err := readJSON(path, &known); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	paths, err := cachedEntries(w.cfg.CacheDir)
	if err != nil {
		return err
	}
	var todo []string
	for _, p := range paths {
		e, err := readEntryFile(p)
		if err != nil {
			return err
		}
		a := e.Author
		if a == nil || a.Login == GhostLogin || a.Typename == "Bot" {
			continue
		}
		if _, ok := known[a.Login]; !ok && !slices.Contains(todo, a.Login) {
			todo = append(todo, a.Login)
		}
	}
	slices.Sort(todo)
	w.log.InfoContext(ctx, "counting prior pull requests", slog.Int("authors", len(todo)))

	before := WindowStart.Format(time.DateOnly)
	for batch := range slices.Chunk(todo, authorsPerRequest) {
		vars := make(map[string]any, len(batch))
		for i, login := range batch {
			vars["q"+strconv.Itoa(i)] = fmt.Sprintf("repo:%s/%s is:pr author:%s created:<%s", Owner, Name, login, before)
		}
		var resp map[string]struct {
			IssueCount int `json:"issueCount"`
		}
		if err := w.client.Do(ctx, ghapi.AuthorBaselines(len(batch)), vars, &resp); err != nil {
			return fmt.Errorf("counting prior pull requests: %w", err)
		}
		for i, login := range batch {
			r, ok := resp["a"+strconv.Itoa(i)]
			if !ok {
				return fmt.Errorf("counting prior pull requests: no answer for %s", login)
			}
			known[login] = r.IssueCount
		}
		if err := writeJSON(path, known); err != nil {
			return err
		}
	}
	if len(todo) == 0 {
		return writeJSON(path, known)
	}
	return nil
}

// counts asks GitHub how many pull requests were opened in the window and
// how many are open now.
func (w *walker) counts(ctx context.Context) (Meta, error) {
	vars := map[string]any{
		"owner": Owner, "name": Name,
		"search": fmt.Sprintf("repo:%s/%s is:pr created:>=%s", Owner, Name, WindowStart.Format(time.DateOnly)),
	}
	var resp struct {
		Search struct {
			IssueCount int `json:"issueCount"`
		} `json:"search"`
		Repository struct {
			PullRequests struct {
				TotalCount int `json:"totalCount"`
			} `json:"pullRequests"`
		} `json:"repository"`
	}
	if err := w.client.Do(ctx, ghapi.Counts, vars, &resp); err != nil {
		return Meta{}, fmt.Errorf("counting pull requests: %w", err)
	}
	return Meta{
		WalkStarted:    w.started,
		OpenedInWindow: resp.Search.IssueCount,
		Open:           resp.Repository.PullRequests.TotalCount,
	}, nil
}
