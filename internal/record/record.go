// Package record owns the committed data: one record per pull request in
// monthly JSON-lines files under data/prs, and data/meta.json and
// data/authors.json beside them.
package record

import "time"

// Names under the data directory.
const (
	PRsDir      = "prs"
	MetaFile    = "meta.json"
	AuthorsFile = "authors.json"
)

// Pull request states.
const (
	StateOpen   = "open"
	StateMerged = "merged"
	StateClosed = "closed"
)

// Lifecycle event kinds.
const (
	KindReady     = "ready"
	KindDraft     = "draft"
	KindForcePush = "force_push"
	KindClosed    = "closed"
	KindReopened  = "reopened"
	KindMerged    = "merged"
)

// Review states.
const (
	ReviewApproved         = "approved"
	ReviewChangesRequested = "changes_requested"
	ReviewCommented        = "commented"
	ReviewDismissed        = "dismissed"
)

// Record is one pull request as committed. Times are UTC to the second,
// lists are in time order, and every list is empty rather than null.
type Record struct {
	Number      int       `json:"number"`
	Updated     time.Time `json:"updated"`
	Title       string    `json:"title"`
	Author      Actor     `json:"author"`
	Association string    `json:"association"`
	Base        string    `json:"base"`
	Created     time.Time `json:"created"`
	State       string    `json:"state"`
	// Draft is whether the pull request is a draft now.
	Draft     bool     `json:"draft"`
	Additions int      `json:"additions"`
	Deletions int      `json:"deletions"`
	Files     int      `json:"files"`
	Labels    []string `json:"labels"`
	Commits   Commits  `json:"commits"`
	// PriorPRs is the author's count of pull requests opened in ceph/ceph
	// before this one. It is nil for a pull request opened before the
	// window start, and when the author has no baseline in authors.json.
	PriorPRs   *int       `json:"prior_prs"`
	Events     []Event    `json:"events"`
	Reviews    []Review   `json:"reviews"`
	Comments   []Comment  `json:"comments"`
	Disclosure Disclosure `json:"disclosure"`
}

// Actor is an account; Bot is GitHub's own typing of it.
type Actor struct {
	Login string `json:"login"`
	Bot   bool   `json:"bot"`
}

// Commits summarizes a pull request's commits. The times are nil when it
// has none.
type Commits struct {
	Count int `json:"count"`
	// FirstAuthored is the earliest author date.
	FirstAuthored *time.Time `json:"first_authored"`
	// LastCommitted is the latest committer date.
	LastCommitted *time.Time `json:"last_committed"`
}

// Event is a lifecycle event; Kind is one of the Kind constants.
type Event struct {
	At   time.Time `json:"at"`
	Kind string    `json:"kind"`
}

// Review is a submitted review; State is one of the Review constants.
type Review struct {
	At    time.Time `json:"at"`
	By    string    `json:"by"`
	Bot   bool      `json:"bot"`
	State string    `json:"state"`
}

// Comment is a conversation comment. Text is kept only for a comment that
// is a single line of at most 80 characters after trimming, and is empty
// otherwise.
type Comment struct {
	At   time.Time `json:"at"`
	By   string    `json:"by"`
	Bot  bool      `json:"bot"`
	Text string    `json:"text,omitempty"`
}

// Disclosure holds the lines that might disclose LLM use: candidates, not
// verdicts, each list de-duplicated in order of first appearance.
type Disclosure struct {
	Trailers    []string `json:"trailers"`
	Description []string `json:"description"`
	CommitProse []string `json:"commit_prose"`
}

// Meta is data/meta.json.
type Meta struct {
	Repo        string    `json:"repo"`
	WindowStart time.Time `json:"window_start"`
	// FetchedThrough is when the last complete walk began.
	FetchedThrough time.Time `json:"fetched_through"`
	GitHubCounts   Counts    `json:"github_counts"`
}

// Counts are GitHub's own counts, taken at the end of the last walk.
type Counts struct {
	OpenedInWindow int `json:"opened_in_window"`
	Open           int `json:"open"`
}
