package tracker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jhoblitt/ceph-dev-stats/internal/version"
)

// MinInterval is the least time between the starts of two requests,
// whatever interval a Client is given.
const MinInterval = time.Second

// attempts is a request's first try and its three retries.
const attempts = 4

// maxBody bounds what is read of one answer; a page of 100 issues with
// their relations is a few hundred kilobytes.
const maxBody = 16 << 20

// Clock is the time a Client paces and backs off by.
type Clock interface {
	Now() time.Time
	// Sleep waits for d, or returns ctx's error when ctx ends first.
	Sleep(ctx context.Context, d time.Duration) error
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

func (realClock) Sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Client asks tracker.ceph.com for tickets: anonymously, one request at a
// time, the starts of two requests at least its interval apart.
type Client struct {
	endpoint string
	agent    string
	http     *http.Client
	clock    Clock
	interval time.Duration
	logger   *slog.Logger

	// mu makes requests sequential even for concurrent callers.
	mu sync.Mutex
	// last is when the previous request was sent, zero before the first.
	last time.Time
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient replaces the default HTTP client. Its cookie jar, if it
// has one, is not used.
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.http = h }
}

// WithClock replaces the wall clock.
func WithClock(clk Clock) Option {
	return func(c *Client) { c.clock = clk }
}

// WithInterval sets the least time between the starts of two requests. An
// interval shorter than MinInterval is raised to it.
func WithInterval(d time.Duration) Option {
	return func(c *Client) { c.interval = d }
}

// WithLogger replaces the logger, slog.Default() otherwise.
func WithLogger(l *slog.Logger) Option {
	return func(c *Client) { c.logger = l }
}

// NewClient returns a client for the Redmine at baseURL. The URL must be
// plain http or https with a host, and carry no user, password or query,
// so that nothing identifying is ever sent.
func NewClient(baseURL string, opts ...Option) (*Client, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		// The url.Error would repeat the URL, which may hold a password.
		return nil, fmt.Errorf("parsing tracker URL: %w", errors.Unwrap(err))
	}
	switch {
	case u.Scheme != "http" && u.Scheme != "https":
		return nil, fmt.Errorf("tracker URL %s: scheme must be http or https", u.Redacted())
	case u.Host == "":
		return nil, fmt.Errorf("tracker URL %s: no host", u.Redacted())
	case u.User != nil:
		return nil, errors.New("tracker URL must not carry a user or password")
	case u.RawQuery != "" || u.ForceQuery || u.Fragment != "":
		return nil, fmt.Errorf("tracker URL %s: must not carry a query or fragment", u.Redacted())
	}
	c := &Client{
		endpoint: strings.TrimSuffix(u.String(), "/") + "/issues.json",
		agent:    userAgent(),
		http:     &http.Client{Timeout: time.Minute},
		clock:    realClock{},
		interval: MinInterval,
		logger:   slog.Default(),
	}
	for _, o := range opts {
		o(c)
	}
	c.interval = max(c.interval, MinInterval)
	if c.http.Jar != nil {
		h := *c.http
		h.Jar = nil
		c.http = &h
	}
	return c, nil
}

// userAgent names the tool and its version, and nothing about its user.
func userAgent() string {
	v := strings.Trim(version.Read().Version, "()")
	if v == "" {
		v = "devel"
	}
	return "cephstats/" + v
}

// Tickets asks for at most BatchSize tickets in one request, with every
// status and with relations. Every ticket asked for is in the answer: one
// the tracker did not return, private or deleted, has an empty type. A
// failed request is retried three times with backoff.
func (c *Client) Tickets(ctx context.Context, ids []int) (map[int]Ticket, error) {
	ids = slices.Compact(slices.Sorted(slices.Values(ids)))
	if len(ids) == 0 {
		return map[int]Ticket{}, nil
	}
	if len(ids) > BatchSize {
		return nil, fmt.Errorf("asking for %d tickets in one request, at most %d", len(ids), BatchSize)
	}
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.Itoa(id)
	}
	// Built by hand to keep the commas and the * readable; nothing in it
	// needs escaping.
	target := c.endpoint + "?issue_id=" + strings.Join(parts, ",") +
		"&status_id=*&include=relations&limit=" + strconv.Itoa(BatchSize)

	c.mu.Lock()
	defer c.mu.Unlock()
	for attempt := 1; ; attempt++ {
		issues, err := c.get(ctx, target)
		if err == nil {
			return tickets(ids, issues), nil
		}
		t, ok := errors.AsType[transient](err)
		if !ok {
			return nil, err
		}
		if attempt == attempts {
			return nil, fmt.Errorf("no usable answer after %d attempts: %w", attempts, t)
		}
		c.logger.WarnContext(ctx, "retrying tracker request",
			slog.Int("attempt", attempt),
			slog.Int("tickets", len(ids)),
			slog.String("error", t.Error()))
		if err := c.clock.Sleep(ctx, 2*time.Second<<(attempt-1)); err != nil {
			return nil, err
		}
	}
}

// transient marks a failure that a retry of the same request could fix.
type transient struct{ err error }

func (t transient) Error() string { return t.err.Error() }
func (t transient) Unwrap() error { return t.err }

type issue struct {
	ID      int `json:"id"`
	Tracker struct {
		Name string `json:"name"`
	} `json:"tracker"`
	Relations []struct {
		IssueID   int    `json:"issue_id"`
		IssueToID int    `json:"issue_to_id"`
		Type      string `json:"relation_type"`
	} `json:"relations"`
}

// pace waits until the interval since the previous request has passed.
func (c *Client) pace(ctx context.Context) error {
	if !c.last.IsZero() {
		if wait := c.last.Add(c.interval).Sub(c.clock.Now()); wait > 0 {
			if err := c.clock.Sleep(ctx, wait); err != nil {
				return err
			}
		}
	}
	c.last = c.clock.Now()
	return nil
}

func (c *Client) get(ctx context.Context, target string) ([]issue, error) {
	if err := c.pace(ctx); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("building tracker request: %w", err)
	}
	req.Header.Set("User-Agent", c.agent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, transient{err}
	}
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	readErr = errors.Join(readErr, resp.Body.Close())

	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= http.StatusInternalServerError:
		return nil, transient{fmt.Errorf("tracker answered HTTP %d", resp.StatusCode)}
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("tracker answered HTTP %d: %s", resp.StatusCode, excerpt(raw))
	case readErr != nil:
		return nil, transient{fmt.Errorf("reading tracker answer: %w", readErr)}
	case len(bytes.TrimSpace(raw)) == 0:
		return nil, transient{errors.New("empty tracker answer")}
	}
	var page struct {
		Issues *[]issue `json:"issues"`
	}
	if err := json.Unmarshal(raw, &page); err != nil {
		return nil, transient{fmt.Errorf("malformed tracker answer: %w", err)}
	}
	if page.Issues == nil {
		return nil, transient{errors.New("tracker answer without issues")}
	}
	return *page.Issues, nil
}

// tickets is the answer to a request for ids, with an empty type for each
// ticket the tracker left out. A ticket not asked for is ignored.
func tickets(ids []int, issues []issue) map[int]Ticket {
	out := make(map[int]Ticket, len(ids))
	for _, id := range ids {
		out[id] = Ticket{}
	}
	for _, is := range issues {
		if _, asked := out[is.ID]; !asked {
			continue
		}
		t := Ticket{Type: is.Tracker.Name}
		if t.Type == TypeBackport {
			t.Parent = parent(is)
		}
		out[is.ID] = t
	}
	return out
}

// parent is the ticket a backport was copied from: Redmine lists the copy
// as the issue_to_id of a copied_to relation whose issue_id is the
// original. The original lists the same relation, which is not a parent
// of its own.
func parent(is issue) int {
	for _, r := range is.Relations {
		if r.Type == "copied_to" && r.IssueToID == is.ID {
			return r.IssueID
		}
	}
	return 0
}

func excerpt(b []byte) string {
	const limit = 200
	s := strings.TrimSpace(string(b))
	if len(s) > limit {
		return s[:limit] + "…"
	}
	return s
}
