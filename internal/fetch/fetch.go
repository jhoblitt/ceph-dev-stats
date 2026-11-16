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
	"github.com/jhoblitt/ceph-dev-stats/internal/record"
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
	// SinceIsDefault says Since is the default rather than the operator's
	// choice. The walk then goes back to WindowStart instead when the
	// cache holds entries of an older FormatVersion, so that every one of
	// them is listed and fetched again.
	SinceIsDefault bool
	// DefaultSince, when set, is the since a walk without --since would
	// have used on this run. meta.json's walk_started becomes, through
	// extract, where the next default walk starts, so a walk from a later
	// Since, which skipped the pull requests updated in between, leaves
	// meta.json as it was. Zero, as for --full, lets any Since write it.
	DefaultSince time.Time
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
// counts to meta.json, unless cfg.Since is later than a set cfg.DefaultSince,
// when it leaves meta.json as it was and warns. A pull request already cached at the listed
// updatedAt, in the current FormatVersion, is not fetched again, so a run
// that stops early can be repeated. While the cache holds entries of an
// older FormatVersion, a walk from a default since starts at WindowStart
// instead, so that it reaches them all.
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
	if err := reachStale(ctx, &cfg); err != nil {
		return err
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
	if !cfg.DefaultSince.IsZero() && cfg.Since.After(cfg.DefaultSince) {
		w.log.WarnContext(ctx, "coverage mark not advanced",
			slog.String("reason", "the walk started later than the default since, so it may have missed pull requests updated in between"),
			slog.Time("since", cfg.Since),
			slog.Time("default_since", cfg.DefaultSince),
			slog.String("path", filepath.Join(cfg.CacheDir, MetaFile)))
		w.log.InfoContext(ctx, "walk finished")
		return nil
	}
	meta, err := w.counts(ctx)
	if err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(cfg.CacheDir, MetaFile), meta); err != nil {
		return err
	}
	w.log.InfoContext(ctx, "walk finished",
		slog.Int("opened_in_window", meta.OpenedInWindow),
		slog.Int("open", meta.Open))
	return nil
}

// reachStale warns when the cache holds entries of an older FormatVersion,
// and then moves a default cfg.Since back to WindowStart so that the walk
// lists, and fetches again, every one of them.
func reachStale(ctx context.Context, cfg *Config) error {
	stale, err := staleEntries(cfg.CacheDir)
	if err != nil || stale == 0 {
		return err
	}
	if cfg.SinceIsDefault {
		cfg.Since = WindowStart
	}
	cfg.Logger.WarnContext(ctx, "cache holds entries of an older format",
		slog.Int("entries", stale),
		slog.Int("format_version", FormatVersion),
		slog.Time("since", cfg.Since))
	return nil
}

// DefaultSince is where a walk starts when no --since is given: a day
// before the last walk recorded in dataDir/meta.json, so updates that
// slipped past that walk are picked up, or the window start when there is
// no meta yet.
func DefaultSince(dataDir string) (time.Time, error) {
	meta, err := record.ReadMeta(dataDir)
	if errors.Is(err, fs.ErrNotExist) {
		return WindowStart, nil
	}
	if err != nil {
		return time.Time{}, err
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

// commentNode and reviewNode take fullDatabaseId as GitHub sent it,
// shadowing the parsed field, so that a value that is not a number is an
// error naming its pull request rather than a page that will not decode.
type commentNode struct {
	Comment
	FullDatabaseID *string `json:"fullDatabaseId"`
}

type reviewNode struct {
	Review
	FullDatabaseID *string `json:"fullDatabaseId"`
}

// prNode is a listed pull request. Its connection fields shadow Entry's
// lists when decoding; they are pointers so that a connection missing from
// the reply, or null, is told apart from an empty one.
type prNode struct {
	Entry
	Labels        *connection[Label]       `json:"labels"`
	Commits       *connection[commitNode]  `json:"commits"`
	Comments      *connection[commentNode] `json:"comments"`
	Reviews       *connection[reviewNode]  `json:"reviews"`
	TimelineItems *connection[Event]       `json:"timelineItems"`
}

// databaseID parses a fullDatabaseId of pull request number; null is no id.
func databaseID(number int, id *string) (int64, error) {
	if id == nil {
		return 0, nil
	}
	n, err := strconv.ParseInt(*id, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("pull request %d: fullDatabaseId %q: %w", number, *id, err)
	}
	return n, nil
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
		// Pointers, so that a reply without either key is told apart from
		// an empty last page.
		var resp struct {
			Repository *struct {
				PullRequests *connection[prNode] `json:"pullRequests"`
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
		if err != nil {
			return connection[prNode]{}, err
		}
		if resp.Repository == nil || resp.Repository.PullRequests == nil {
			return connection[prNode]{}, errors.New("reply without repository.pullRequests")
		}
		return *resp.Repository.PullRequests, nil
	}
}

// store fetches the rest of n's connections and caches it, unless the
// cache already holds it in the current format at the same or a later
// updatedAt.
func (w *walker) store(ctx context.Context, n *prNode) (bool, error) {
	cached, err := ReadEntry(w.cfg.CacheDir, n.Number)
	switch {
	case err == nil && cached.FormatVersion >= FormatVersion && !n.UpdatedAt.After(cached.UpdatedAt):
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
	comments, err := rest(ctx, w, n.Number, ghapi.Comments, n.Comments)
	if err != nil {
		return false, err
	}
	e.Comments = make([]Comment, len(comments))
	for i, c := range comments {
		e.Comments[i] = c.Comment
		if e.Comments[i].DatabaseID, err = databaseID(n.Number, c.FullDatabaseID); err != nil {
			return false, err
		}
	}
	reviews, err := rest(ctx, w, n.Number, ghapi.Reviews, n.Reviews)
	if err != nil {
		return false, err
	}
	e.Reviews = make([]Review, len(reviews))
	for i, r := range reviews {
		e.Reviews[i] = r.Review
		if e.Reviews[i].DatabaseID, err = databaseID(n.Number, r.FullDatabaseID); err != nil {
			return false, err
		}
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
	e.FormatVersion = FormatVersion

	if err := writeJSON(entryPath(w.cfg.CacheDir, e.Number), e); err != nil {
		return false, err
	}
	w.log.DebugContext(ctx, "cached pull request",
		slog.Int("number", e.Number),
		slog.Time("updated_at", e.UpdatedAt))
	return true, nil
}

// rest returns first's nodes followed by every later page of connection c
// of pull request number. A first page or a later one that the reply left
// out, or gave as null, is an error rather than an empty last page.
func rest[T any](ctx context.Context, w *walker, number int, c ghapi.Connection, first *connection[T]) ([]T, error) {
	if first == nil {
		return nil, fmt.Errorf("listing pull request %d: reply without %s", number, c)
	}
	nodes := first.Nodes
	info := first.PageInfo
	for info.HasNextPage {
		var resp struct {
			Repository struct {
				PullRequest map[string]*connection[T] `json:"pullRequest"`
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
		if page == nil {
			return nil, fmt.Errorf("paging %s of pull request %d: reply without repository.pullRequest.%s", c, number, c)
		}
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
	path := filepath.Join(w.cfg.CacheDir, AuthorsFile)
	known := map[string]int{}
	if err := ReadJSON(path, &known); err != nil && !errors.Is(err, fs.ErrNotExist) {
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
		// Pointers, so that a missing or null answer is not a count of 0,
		// which would be kept for good.
		var resp map[string]*struct {
			IssueCount *int `json:"issueCount"`
		}
		if err := w.client.Do(ctx, ghapi.AuthorBaselines(len(batch)), vars, &resp); err != nil {
			return fmt.Errorf("counting prior pull requests: %w", err)
		}
		for i, login := range batch {
			r := resp["a"+strconv.Itoa(i)]
			if r == nil || r.IssueCount == nil {
				return fmt.Errorf("counting prior pull requests: no answer for %s", login)
			}
			known[login] = *r.IssueCount
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
