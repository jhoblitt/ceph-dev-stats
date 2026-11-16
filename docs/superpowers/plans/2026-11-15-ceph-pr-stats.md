# Ceph Pull-Request Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an interactive GitHub Pages page of `ceph/ceph`
pull-request statistics over the last six months, refreshable with one
command.

**Architecture:** A Go CLI, `cephstats`, walks GitHub's GraphQL API into a
local raw cache (`fetch`), turns each cached PR into a compact committed
record (`extract`), validates the hand-edited tables against the records
(`check`), and writes the site's data as columns by year (`rollup`). A Vite +
Svelte + TypeScript site fetches those files and computes every statistic in
the browser. semantic-release tags each merge to `main`; the tag deploys to
Pages.

**Tech Stack:** Go 1.27 (per `go-conventions`: cobra, viper, `log/slog`,
Ginkgo v2 and Gomega), `net/http` and `encoding/json` with hand-written
GraphQL queries (no GitHub client library), YAML tables, Vite, Svelte 5,
TypeScript, `d3-scale`, `d3-shape`, `d3-array`, Vitest, Playwright, GitHub
Actions, semantic-release.

**Spec:** `docs/superpowers/specs/2026-11-15-ceph-pr-stats-design.md`

This plan follows the owner's rule that plans carry behaviour and seams, not
code. Code blocks are sketches; behaviour, seams and values bind. An
implementer who finds a sketch that contradicts another task follows the
behaviour and records the ruling in the PR description.

## Global Constraints

- Repository `jhoblitt/ceph-dev-stats`, public. Pages base path
  `/ceph-dev-stats/`. Module `github.com/jhoblitt/ceph-dev-stats`, binary
  `cephstats`, environment prefix `CEPHSTATS_`.
- The only source is `ceph/ceph`. The window starts at
  `2026-05-15T00:00:00Z` and never moves: the data accumulates.
- The GitHub token is read from the environment only:
  `CEPHSTATS_GITHUB_TOKEN`, else `GH_TOKEN`, else `GITHUB_TOKEN`. It is never
  a flag, never logged, never written to disk.
- No test calls the live API. Fetch is tested against `httptest` servers and
  recorded responses.
- Raw API responses live in `.cache/` and are gitignored. Committed:
  `data/prs/*.jsonl`, `data/authors.json`, `data/meta.json`,
  `data/tickets.json`, `data/*.yaml`.
- Requests to tracker.ceph.com are anonymous, sequential, batched, at most
  one a second, and send a User-Agent naming the tool and its version and
  nothing about its user. A ticket already in `data/tickets.json` is not
  asked for again.
  Everything under `site/public/data/` is build output and gitignored. No
  derived statistic is committed.
- All times are UTC. A week is an ISO week, Monday 00:00 UTC.
- Wording on the page: "disclosed" and "not disclosed". Never
  "human-written", "AI-written" or "LLM-generated".
- People are shown by GitHub handle, each linked to
  `https://github.com/<login>`. The site data's `people` holds the login of
  every person an `author` or an `actor` index names (Seam 4); a bot
  command, a bot's comment or review, and the author's own comments and
  reviews carry no actor. The owner asked for
  sorting by author and by reviewer; an earlier rule against ranking named
  people was the builder's and is withdrawn.
- No duration on the page is negative or NaN: a span that cannot be
  measured is unknown.
- Any Go work: load `go-conventions:go-conventions` first. Any workflow,
  commit, PR or repo-config work: load
  `github-conventions:github-conventions` first. Any chart work: load
  `dataviz` first. Their rules bind over this plan's sketches.
- Shell is thin glue; logic lives in Go (tooling) or TypeScript (site).
- Scratch goes in `$TMPDIR`. Subagents: at most 4 in flight, `model: opus`.
- Each task lands as its own PR, merged once CI is green (the owner granted
  this, as on the sibling), except Task 1's first commit, which seeds
  `main`. Nothing is deployed before Task 13. Check in with the owner when
  Task 13's page is live.
- A data refresh is user-visible content and must cut a release.

## Review Focus

1. GitHub returns an empty or 5xx response mid-walk, or the hourly allowance
   runs out (an oversized page came back empty while probing). Expected:
   retry with backoff, halve the page size after repeated failure, stop
   cleanly on exhaustion naming the reset time, and a re-run resumes without
   refetching PRs already cached at the same `updatedAt` (Task 2).
2. A PR is updated while the walk runs, so it appears on two pages or slips
   between them. Expected: one cache entry per PR, the later `updatedAt`
   wins, and the next refresh's overlap picks up anything that slipped
   (Task 2).
3. A deleted account: GitHub returns a null author for a PR, a comment or a
   review. Expected: recorded as `ghost`; a ghost commenter is never taken
   for the PR's author, even when the author is a ghost too; nothing crashes
   (Tasks 3, 6).
4. Timestamps out of order: a response before the waiting clock starts, a
   last commit before the first, a merge before the PR was marked ready, a
   commit dated in the future. Expected: the span clamps at zero or becomes
   unknown, never negative (Tasks 6, 8).
5. A shared link with an unknown filter value, a period outside the data, or
   a selection matching no PRs. Expected: unknown values fall back to
   defaults, and an empty selection draws empty charts with "no PRs match",
   not errors (Tasks 7, 9).

---

## File Structure

```
cmd/cephstats/              main
internal/cli/               cobra tree: fetch, extract, check, rollup
internal/ghapi/             GraphQL transport: token, retries, rate limit, queries
internal/fetch/             the walk, nested paging, the raw cache
internal/record/            the committed record, monthly JSONL, meta, authors
internal/extract/           raw PR → record
internal/tables/            the hand-edited YAML tables: load and validate
internal/classify/          record + tables → kinds, disclosure, components
internal/rollup/            classified records → site data files
internal/tracker/           tracker.ceph.com: ticket types, batched and polite
data/tools.yaml             what counts as a disclosure, and tool families
data/bots.yaml              bot accounts GitHub types as users
data/commands.yaml          bot commands
data/labels.yaml            label → component, process state, or other
data/kinds.yaml             what makes a PR a bug fix, a feature, …
data/tickets.json           type of each tracker ticket a record references
data/prs/YYYY-MM.jsonl      committed records, by month opened
data/authors.json           prior-PR baselines at the window start
data/meta.json              window start, fetch high-water mark, counts
site/                       Vite + Svelte app
site/public/data/           rollup output (gitignored)
site/src/lib/data.ts        load and type the site data
site/src/lib/select.ts      filters → row selection
site/src/lib/stats/         outcome curves, weekly series, spans, shares
site/src/lib/state.ts       URL-backed filters and selection
site/src/components/        filters, charts, table, timelines
site/src/content/methods/   methods prose
.github/workflows/          ci, commitlint, workflow-lint, release, deploy, …
```

## Seams

Four formats cross task boundaries. Each is fixed here so tasks on either
side can proceed from fixtures.

### Seam 1 — raw cache (Task 2 → Task 3)

`.cache/raw/<number>.json`: one PR's GraphQL node with every nested
connection fully paged and merged, plus the walk's `fetchedAt`. Fields:
`number title body state isDraft createdAt updatedAt closedAt mergedAt
baseRefName additions deletions changedFiles authorAssociation`,
`author{login __typename}`, `labels{name}`,
`commits{authoredDate committedDate message}`,
`comments{createdAt body author{login __typename}}`,
`reviews{submittedAt state author{login __typename}}`, and timeline events
of types `READY_FOR_REVIEW_EVENT`, `CONVERT_TO_DRAFT_EVENT`,
`HEAD_REF_FORCE_PUSHED_EVENT`, `CLOSED_EVENT`, `REOPENED_EVENT`,
`MERGED_EVENT`, each with `createdAt`.

For the links back to GitHub the entry also carries: each commit's `oid`;
each comment's and review's `fullDatabaseId`; the `url` of each ready, draft,
closed and merged event; the merged event's `commit{oid}`; and a
force-push's `beforeCommit{oid}` and `afterCommit{oid}`. Each entry records
the cache format's version, and an entry of an older version is fetched
again whatever its `updatedAt`.

`.cache/authors.json`: login → number of PRs opened in `ceph/ceph` before
the window start. `.cache/meta.json`: `walk_started`, when the walk began,
and GitHub's own counts taken at its end, `opened_in_window` (PRs opened
since the window start) and `open`.

### Seam 2 — the record (Task 3 → Tasks 4, 5, 6)

`data/prs/YYYY-MM.jsonl`, the month of `created`; one PR per line, sorted by
number, keys in a fixed order, so two runs over the same cache write the
same bytes.

```
{ "number", "updated", "title",
  "author": {"login", "bot"}, "association",
  "base", "created", "state": "open|merged|closed", "draft",
  "additions", "deletions", "files", "labels": [sorted],
  "commits": {"count", "first_authored", "last_committed",
              "list": [ {"sha", "authored", "committed"} ]},
  "prior_prs": n | null,
  "events":   [ {"at", "kind": "ready|draft|force_push|closed|reopened|merged", "id", "sha"} ],
  "reviews":  [ {"at", "id", "by", "bot", "state": "approved|changes_requested|commented|dismissed"} ],
  "comments": [ {"at", "id", "by", "bot", "text"} ],
  "disclosure": {"trailers": [], "description": [], "commit_prose": []},
  "kind_hints": {"checklist": [], "tickets": [], "backport_of": n} }
```

- Times are RFC 3339 UTC to the second. Lists are in time order.
- `bot` is GitHub's own typing of the account. `data/bots.yaml` is applied
  later, in classify, so it can change without a new extract.
- A null author is `{"login": "ghost", "bot": false}`.
- Links: a comment's and a review's `id` is GitHub's database id. An
  event's `id` is the number in its GitHub address (`#event-<id>`), present
  for ready, draft, closed and merged; its `sha` is the merge commit for
  merged and the pushed commit for force_push. A field with nothing to hold
  is left out. Addresses are never stored; the PR's follows from its
  number.
- `comments[].text` is present only when the comment is a single line of at
  most 80 characters after trimming and contains no `@`, which a bot
  command never does and a mention or an address always does. That is what
  the bot-command table and
  the "looks like a command" report need; longer comments are not stored.
- `disclosure` holds candidates, not verdicts, de-duplicated:
  - `trailers`: a commit-message line of the form `Key: value`, anywhere
    in the message, whose key matches the broad word list, or whose key ends
    in `-by` and whose value matches it. So a `Co-authored-by:` naming a
    person is dropped. Lines with these keys are never kept, in a commit or
    in a description: `Signed-off-by`, `Reviewed-by`, `Tested-by`,
    `Acked-by`, `Reported-by`, `Suggested-by`, `Cc`, `Fixes`, `Resolves`,
    `See-also`, `Backport`, `Change-Id`, `Conflicts`, `Link`, `URL`. This
    keeps people's names and addresses out of the data.
  - `description` and `commit_prose`: lines of the PR description, and of
    commit messages outside trailers, that match the broad word list, each
    cut at 200 characters.
  - The broad word list is in the extract code and is generous: it must
    keep every form listed in the spec's Measurements.
- `prior_prs` is the author's baseline from `data/authors.json` plus the
  number of that author's records opened at or after the window start and
  before this PR. It is `null` for a PR opened before the window start,
  and for an author with no baseline (a bot, a deleted account).
- `kind_hints` holds what a kind can be decided from, not the decision:
  - `checklist`: the ticked boxes of the PR template's Tracker section, as
    `references_ticket`, `very_recent_bug`, `new_feature`, `doc_update`,
    `code_cleanup`, in that order;
  - `tickets`: the tracker.ceph.com issue numbers the PR references, first
    from its commits' `Fixes:` trailers in commit order, then from its
    description, de-duplicated;
  - `backport_of`: the PR number a description's "backport of" names.
  An empty hint is left out, and so is `kind_hints` when all three are.

`data/tickets.json`: an object, ticket number → `{"type", "parent"}`,
keys in numeric order. `type` is the tracker's name for the ticket's type,
empty when the tracker would not show the ticket. `parent` is the ticket a
Backport ticket was copied from, left out otherwise; a parent is itself an
entry.

`data/meta.json`: `repo`, `window_start`, `fetched_through` (when the last
walk began), and GitHub's counts from that walk.

### Seam 3 — the tables (Task 4 ↔ Tasks 5, 6)

```
tools.yaml
  trailer_keys: [assisted-by, …]      # keys that make a trailer a disclosure
  phrases: [regexp, …]                # a description or prose line must match one
  families: [ {id, name, patterns: [regexp, …]} ]   # first match wins
  ignore: [ {line, why} ]             # candidates judged not a disclosure
bots.yaml
  accounts: [ {login, why} ]
commands.yaml
  commands: [ {id, name, pattern} ]   # against the whole lower-cased comment
labels.yaml
  components: [ {id, name, labels: [name or glob, …]} ]
  process: [name or glob, …]
  other: [name or glob, …]
kinds.yaml
  kinds: [ {id, name} ]               # bugfix, feature, cleanup, docs, other
  checklist: { new_feature: feature, … }      # a box → a kind
  tracker: { Bug: bugfix, Backport: parent, … }   # a ticket type → a kind
  labels: { bug-fix: bugfix, … }
  order: [checklist, tracker, labels]
```

### Seam 4 — site data (Task 6 → Tasks 7–12)

Under `site/public/data/`, fetched at run time, never bundled.

- `meta.json`: `repo`, `fetched_through`, `window_start`, `years`, and the
  dictionaries every index below refers to: `bases`, `components`,
  `families`, `commands`, `kinds`, `disclosure` (`none`, `description`,
  `coauthor`, `trailer`), `event_kinds`, and `people`, the login of every
  person an `author` or an `actor` index names, with `people_bots`, the
  indexes among them that are bot accounts.
- `prs-<year>.json`, the year the PR opened; arrays of equal length, rows
  sorted by number. Times are epoch seconds; `-1` means none or unknown.

  ```
  number created ready closed state(0 open,1 merged,2 closed) base
  draft opened_draft reopened in_window
  additions deletions files commits
  first_commit last_commit first_response first_approval
  human_reviews bot_reviews bot_commands
  disclosure families[][] components[][] standing kind author
  ```

  `kind` indexes `kinds`, a list of `{id, name}`; `-1` is unknown. `author`
  indexes `people`. `closed` is the time of the last `merged` or `closed`
  event when the PR is not open, the record's `updated` when a finished PR
  has no such event, and `-1` only for an open PR.

- `events-<year>.json`: arrays `pr` (row in that year's file), `at`, `kind`,
  `sub`, `actor`; sorted by `pr`, then `at`. Kinds: `comment_other`,
  `comment_author`, `command_author`, `command_other`, `bot_account`,
  `review_approved`, `review_changes`, `review_commented`, `bot_review`,
  `review_author`, `ready`, `draft`, `force_push`, `closed`, `reopened`,
  `merged`. `review_author` is a review by the PR's own author, with actor
  `-1` and its review id as ref; it is not a human review, a response or an
  approval. `sub` is the command's index for a command, else `-1`. `actor`
  indexes `people` for `comment_other` and the three human review kinds,
  else `-1`; the indexes are stable for a given set of records. A `closed`
  event at, or within five seconds after, a `merged` event of the same PR
  is not written: GitHub records the close a merge causes up to a few
  seconds after it, and the page shows one mark. A merged PR with no
  `merged` event, which GitHub marks merged without recording one, has its
  last `closed` event written as `merged` at that time, with an empty ref.
- `table-<year>.json`: `titles` and `authors`, aligned with the PR rows.
  It also carries `commits`, one list per PR row of `[sha, authored,
  committed]`, and `refs`, one string per event of that year's events file
  in the same order: the comment, review or event id, or the SHA for
  `merged` and `force_push`, or the empty string. The site builds every
  GitHub address from these and the PR number. It carries too, per PR
  row, `tickets` (the referenced ticket numbers), `backport_of` (the PR
  number, or `0`) and `kind_source` (`checklist`, `tracker`, `labels`,
  `original` or the empty string).
- Rulings made while building, part of this seam: `window_start` and
  `fetched_through` in `meta.json` are epoch seconds; `components`,
  `families` and `commands` are lists of `{id, name}`, and `bases`,
  `disclosure` and `event_kinds` lists of strings; each PR's `families` and
  `components` list is sorted ascending.

---

### Task 1: Repository bootstrap

**Files:** repo root scaffolding, `.github/**`, `go.mod`, `Makefile`,
`.golangci.yml`, `README.md`, `LICENSE`, `.commitlintrc.yml`, `.nvmrc`,
`.gitignore`.

- [ ] Run `go-conventions:go-new-project` for module
  `github.com/jhoblitt/ceph-dev-stats` with one binary, `cephstats`, whose
  subcommands `fetch`, `extract`, `check` and `rollup` exist and return
  "not implemented".
- [ ] Run `github-conventions:github-new-repo`: visibility **public**;
  license Apache-2.0, as the sibling; description "Interactive statistics on
  ceph/ceph pull requests"; homepage the Pages URL. The existing
  `docs/superpowers/` files go in the seed commit.
- [ ] `.gitignore` adds `/.cache/`, `/site/public/data/`, the site's
  `node_modules`, `dist` and `test-results`, `/.superpowers/` and
  `/.claude/`.
- [ ] CI as the sibling's `ci.yml`: Go test, lint, the no-diff checks and
  govulncheck, plus placeholder `data-check` and `site` jobs later tasks
  fill. Commitlint, workflow-lint, CodeQL, dependency review, Scorecard,
  dependabot (gomod, npm under `/site`, github-actions) and the `main`
  ruleset per the canon: a PR and the CI checks required, no required
  approvals, squash merge only.
- [ ] Verify: `make check` passes locally (unsandboxed); the first PR's CI
  is green.

The working directory is not yet a git repository. Inside the sandbox it
shows character-device dotfiles (`.bashrc`, `.gitconfig`, …) that are mounts,
not files: stage by explicit path, never `git add -A`.

**Produces:** a `main` every later task branches from; `make check`.

### Task 2: `cephstats fetch`

**Files:** `internal/ghapi/*`, `internal/fetch/*`, `internal/cli/fetch.go`,
tests beside them.

**Behaviour:**
- `cephstats fetch [--since <RFC 3339>] [--full] [--cache-dir .cache]`.
  `--since` defaults to `data/meta.json`'s `fetched_through` minus 24 hours,
  or to the window start when there is no meta. `--full` is the window
  start.
- Phase 1 walks `pullRequests` ordered by `UPDATED_AT` descending and stops
  at the first PR whose `updatedAt` is before `--since`. Phase 2 walks every
  open PR. Phase 3 asks, for each PR author with no entry in
  `.cache/authors.json`, how many PRs that login opened before the window
  start (a search `issueCount`), 25 logins to a request.
- A PR whose cached `updatedAt` equals the listed one is skipped. Otherwise
  its commits, comments, reviews and events are paged to the end and the
  entry is written whole, through a temporary file and a rename, so an
  interrupted run leaves no partial entry.
- Page size starts at 25 PRs. A failed or empty response is retried with
  backoff; after three failures the page size halves, down to 1. A rate
  limit stops the run with an error naming the reset time.
- Requests are sequential. Progress goes to the log; the two GitHub counts
  and the walk's start time go to `.cache/meta.json` at the end.

**Tests** (an `httptest` server scripted per spec):
- a PR with 3 pages of commits, 2 of comments and 2 of reviews is cached
  with all of them, in order;
- the walk stops at `--since` and does not request the next page;
- a PR listed on two pages is cached once, at the later `updatedAt`;
- a second run over an unchanged server makes no nested-page requests;
- two empty responses then a good one succeed; persistent failure halves
  the page size, and the request bodies show it;
- a rate-limit response ends the run with the reset time in the error and
  leaves earlier entries intact;
- the token is absent from every log line and from the cache;
- no token in the environment is an error before any request.

- [ ] Tests first, implement, pass. `make check`.

### Task 3: The record and `cephstats extract`

**Files:** `internal/record/*`, `internal/extract/*`,
`internal/cli/extract.go`, fixtures under `internal/extract/testdata/`.

**Behaviour:**
- `cephstats extract [--cache-dir .cache] [--data data]` upserts: it
  reads the existing monthly files, replaces the record of every cached PR
  whose `updatedAt` is newer than the record's `updated`, and rewrites only
  the months that changed. With an empty cache it changes nothing. An
  `--all` flag, to re-derive every cached PR, was built and then removed:
  a plain run already re-derives every record a current-format entry is as
  new as, so all it added was letting an older cache entry overwrite a
  record.
- It copies `.cache/authors.json` into `data/authors.json` (sorted) and the
  cache's meta into `data/meta.json`.
- Record fields follow Seam 2. `commits.first_authored` is the earliest
  author date and `commits.last_committed` the latest committer date among
  the PR's commits.

**Tests** (fixtures in Seam 1's shape):
- a backport, a draft later marked ready, a PR closed and reopened then
  merged, a PR force-pushed, and a PR whose commits all postdate its
  opening each give the expected record;
- every disclosure form in the spec's Measurements lands in the right
  candidate list; a `Co-authored-by:` naming a person is not kept; a
  description that names Copilot without disclosing is kept as a candidate
  (the verdict is Task 4's);
- a one-line comment of 80 characters keeps its text and one of 81 does
  not; a multi-line comment does not;
- null authors become `ghost`;
- `prior_prs` for an author's third PR in the window with a baseline of 4
  is 6, and is `null` for a PR opened before the window;
- two runs write identical bytes; a run after one PR changed rewrites
  exactly one monthly file.

- [ ] Tests first, implement, pass. `make check`.

### Task 14: Links back to GitHub

Runs after Task 3 and before Task 5's pull. The owner asked for it during
the build.

**Files:** `internal/ghapi/queries.go`, `internal/fetch/*`,
`internal/record/*`, `internal/extract/*`, their tests and fixtures.

**Behaviour:**
- `fetch` requests the link fields of Seam 1 and stores them. The cache
  entry gains a format version; an entry of an older version is fetched
  again, so the first run after this task re-pulls the whole cache.
- `extract` fills the record's link fields of Seam 2: `commits.list` in
  commit order, `id` on comments and reviews, `id` and `sha` on events.
  `first_authored` and `last_committed` stay as they are.
- An event's `id` is parsed from the trailing `#event-<digits>` of its
  address. An address of any other shape leaves the field out and is
  logged once per run, not once per event.

**Tests:**
- the queries name every link field, and a scripted server's ids and SHAs
  reach the cache entry;
- a cached entry without a version is fetched again though its `updatedAt`
  is unchanged, and an entry of the current version is not;
- a fixture PR with a comment, a review, three commits, a force-push, a
  ready event, a close, a reopening and a merge gives a record whose every
  link field holds the fixture's value, and whose reopening has neither
  `id` nor `sha`;
- a record without link fields, written before this task, still reads, and
  the next `extract` run rewrites it with them from a current-format entry
  (`extract --all`, which this once named, was removed: all it added to a
  plain run was letting an older cache entry overwrite a record).

- [ ] Tests first, implement, pass. `make check`.

### Task 15: What kind of change a PR is

Runs after Task 3, beside Task 14. The owner asked for it during the build
and chose to read ticket types from tracker.ceph.com.

**Files:** `internal/extract/*`, `internal/record/*`, `internal/tracker/*`,
`internal/cli/tickets.go`, `internal/cli/root.go`, their tests and fixtures.

**Behaviour:**
- `extract` fills `kind_hints` as Seam 2 says. A box is ticked when its
  line reads `[x]` or `[X]`. A ticket is any
  `tracker.ceph.com/issues/<digits>`. "backport of" is followed by a
  ceph/ceph pull-request URL or `#<digits>`, in any case.
- `cephstats tickets [--data data] [--tracker-url https://tracker.ceph.com]`
  collects the ticket numbers of every record, drops those already in
  `data/tickets.json`, and asks the tracker for the rest, 100 to a request,
  through its issue list filtered by id with every status and with
  relations included. For a Backport ticket it records the ticket it was
  copied from as `parent` and asks for that one too. A ticket the tracker
  does not return is recorded with an empty type, so it is not asked for
  again. The file is rewritten sorted, through a temporary file and a
  rename, after each batch.
- The requests follow the Global Constraints. A failed request is retried
  with backoff three times; then the run stops with what it has saved.
- `cephstats tickets --refresh` asks again for the tickets whose type is
  empty.

**Tests** (an `httptest` server; no test reaches the tracker):
- ticks, tickets and "backport of" in each form above give the expected
  hints, in the stated order; a box not ticked, a ticket URL of another
  host and a "backport of" with no number give none; a record with no
  hints has no `kind_hints` key;
- 250 unknown tickets take three requests of at most 100 ids, a second run
  takes none, and the request carries the User-Agent and no credentials;
- a Backport ticket's parent is recorded and fetched; a ticket the tracker
  omits gets an empty type, is skipped on the next run, and is asked for
  again with `--refresh`;
- two requests are at least the configured interval apart (the clock is
  injected);
- a server that fails four times ends the run with the earlier batches
  saved.

- [ ] Tests first, implement, pass. `make check`.
- [ ] The controller confirms once against the live tracker that the
  filtered list returns types and relations as the code expects.

### Task 4: Tables, classification and `cephstats check`

**Files:** `internal/tables/*`, `internal/classify/*`,
`internal/cli/check.go`, skeleton `data/*.yaml` seeded from the spec's
Measurements, CI's `data-check` job, `make data-check`.

**Behaviour — classification:**
- **Human**: not typed a bot by GitHub and not listed in `bots.yaml`.
- **Comment kind**, in this order: from a bot account; a bot command (the
  whole lower-cased text matches a `commands.yaml` pattern), from the PR's
  author or from someone else; by the author; by another person.
- **Disclosure class**, the highest present: `trailer` (a candidate trailer
  whose key is in `trailer_keys`), `coauthor` (a kept `Co-authored-by:`),
  `description` (a description or prose candidate matching a phrase), else
  `none`. A candidate listed under `ignore` counts for nothing.
- **Families**: every family whose pattern matches a counted disclosure's
  text.
- **Components**: the components whose labels the PR carries.
- **Kind**, by `kinds.yaml`'s `order`: `checklist` gives a kind when the
  ticked boxes that name one all name the same one; `tracker` gives the
  kind of the first ticket in `kind_hints.tickets` whose type maps to one,
  a type mapped to `parent` standing for its parent ticket; `labels` gives
  the kind of a kind label when all such labels agree. A PR with
  `backport_of` takes that PR's kind first, when it is in the records and
  has one, and its source is `original`. No source gives unknown.

**Behaviour — `cephstats check`** fails, listing every problem, on:
- a table that does not parse, an invalid regexp, a duplicate id;
- a candidate trailer whose key is neither in `trailer_keys`, nor
  `Co-authored-by`, nor covered by `ignore`;
- a counted disclosure whose text matches no family;
- a label carried by 5 or more PRs that no table entry classifies;
- a ticket type in `data/tickets.json` that `kinds.yaml` does not map, or a
  kind it names that is not in `kinds`;
- records whose counts disagree with `data/meta.json`'s GitHub counts by
  more than 0.5%, which allows for PRs opened or closed during the walk.

It reports, without failing: the description candidates that matched no
phrase, most frequent first; the short comments by people that matched no
command, most frequent first; the accounts with the most comments that are
not typed bots; and the base branches seen, with their counts.

**Tests:** each classification rule with a minimal record; kind precedence
(a bot account posting command text is a bot account; the author posting
`jenkins test make check` is a command, not an author comment); every
`check` failure with a minimal bad fixture; a clean fixture passes.

- [ ] Tests first, implement, pass. Wire `make data-check` into CI.

### Task 5: The first pull and the tables' contents

**Files:** `data/prs/*.jsonl`, `data/authors.json`, `data/meta.json`,
`data/*.yaml`, `Makefile` (`data-refresh`), `README.md` ("Updating").

This is the analysis the page rests on.

- [ ] `make data-refresh`: `cephstats fetch`, then `extract`, then
  `tickets`, then `check`, taking the token from `gh auth token` when the
  environment has none. Run it for the first time with `fetch --full`
  (unsandboxed).
- [ ] Work `cephstats check` to a clean pass by filling the tables:
  - `labels.yaml`: every label carried by 5 or more PRs, as a component, a
    process state or other.
  - `commands.yaml`: start from the spec's list and add what the "looks
    like a command" report shows.
  - `bots.yaml`: user-typed accounts whose comments are automated.
  - `tools.yaml`: trailer keys, phrases, families. `LLM` and `AI` alone map
    to a family named "unspecified".
  - `kinds.yaml`: every ticket type the tracker returned, the four
    checklist boxes, and the kind labels. Record in the PR description how
    many PRs each source decided and how many stay unknown.
- [ ] Spot-check 30 PRs by hand against GitHub: 10 disclosed, 10 not, 5
  backports, 5 with bot commands. Record each disagreement and its fix.
- [ ] Record in the PR description: the counts beside GitHub's, the API
  points spent, and every judgment call in the tables. The tables are the
  owner's to correct.
- [ ] Confirm which changes move a PR's `updatedAt`: run a refresh a day
  later and compare, for 20 PRs that received a comment, a review, a push,
  a label or a close since, the record against GitHub. Write the result in
  the README's "Updating" section, with `fetch --full` as the fallback.

### Task 6: `cephstats rollup`

**Files:** `internal/rollup/*`, `internal/cli/rollup.go`, `Makefile`
(`site-data`), a small committed fixture dataset the site's tests share
(`site/src/lib/__fixtures__/data/`, written by a spec from hand-made
records).

**Behaviour:** `cephstats rollup --out site/public/data` writes Seam 4 from
the records and tables. Per PR:

- `opened_draft`: the first draft event is `ready`, or the PR is a draft now
  with no draft event.
- `ready`: `created`, or the first `ready` event when `opened_draft`; `-1`
  when it was never ready.
- `closed`: the time of the last `merged` or `closed` event when the PR is
  not open, else `-1`. `reopened`: the number of `reopened` events.
- `first_response`: the earliest `comment_other` or human review by someone
  other than the author; clamped to no earlier than `ready`; `-1` if none or
  if `ready` is `-1`.
- `first_approval`: the earliest approving review by a human other than the
  author, clamped the same way.
- `first_commit`: `commits.first_authored`, or `-1` when it is after
  `created`. `last_commit`: `commits.last_committed`.
- `standing`: `prior_prs`, or `-1`. `in_window`: `created` at or after the
  window start.
- `kind`: the classification's kind as an index into `kinds`, or `-1`. The
  table file carries each row's `tickets`, `backport_of` and `kind_source`.
- `actor` indexes are assigned in order of first appearance over the whole
  dataset, so they are stable for a given set of records.
- `table-<year>.json` carries `commits` and `refs` as Seam 4 says: `refs`
  has one entry per event, in the events file's order.

**Tests:** each derivation above with a minimal record, including the
out-of-order cases of Review Focus 4 (a response before `ready`, a review by
a ghost on a ghost's PR); every column of a year file has one length; every
index is inside its dictionary; events are sorted and each `pr` is a valid
row; every `author` and `actor` is inside `people`, and `people` holds no
login twice; two runs write identical bytes.

- [ ] Tests first, implement, pass. `make check`.

### Task 7: Site shell

May start once Task 1 has merged: it needs only Seam 4 and a hand-made
fixture, which Task 6's fixture later replaces.

**Files:** `site/` (Vite, Svelte 5, TypeScript, Vitest),
`site/src/lib/{data,state,version,theme}.ts`, header, footer, filter bar,
routes; `Makefile` targets `site-install`, `site-build`, `site-test`,
`site-dev-data`; CI's `site` job.

**Behaviour:**
- Take the sibling's shell as the starting point: header, footer, theme
  toggle, `tokens.css`, `base.css`, `version.ts`, and `state.ts`'s
  hash-parsing pattern. Vite base `/ceph-dev-stats/`.
- `make site-build` runs `cephstats rollup`, then `vite build`.
  `make site-dev-data` copies the fixture into `site/public/data/`.
- `data.ts` loads `meta.json`, then the year files the period needs, into
  typed arrays; `table-<year>.json` only on demand. A year that fails to
  load shows an error naming the file, and the rest of the page still
  works.
- Header: "data as of" the `fetched_through` date. Footer: `v<version>`
  linking to its release, and a link to the repository.
- The filter bar holds: period, target (main, backports and other branches,
  all), component, size band, author standing band, disclosure, drafts,
  reopened. Defaults: the whole window, `main`, everything else unfiltered.
- `state.ts` keeps the filters, the selected week or band, and the selected
  PR in the URL hash, and restores them on load.
- Routes: `#/` and `#/methods`. The page body has one empty, named section
  per later task (velocity, review, llm, dots, timelines, table), so Tasks
  9–11 add components without editing each other's files.

**Tests (Vitest):** state round-trips through the hash; unknown values,
malformed hashes and a period outside the data yield defaults; `data.ts`
rejects a year file whose columns differ in length.

### Task 8: Statistics library

**Files:** `site/src/lib/select.ts`, `site/src/lib/stats/*.ts`, tests
beside them. Pure functions over typed arrays; no DOM.

**Seams:**

```
select(data, filters): Uint32Array                 // row ids
outcomeCurve(data, rows, span): Curve
  // span: response | approval | merge | afterApproval | afterLastCommit
  //       | firstCommitToOpened | openedToLastCommit
  // Curve: { days: number[], shares: { [outcome]: number[] } }
quantileDays(curve, outcome, q): number | null     // null: not yet known
weekly(data, rows, series): { week: number[], values: Record<string, number[]> }
  // series: opened | merged | closed | reviews | reviewers | commands
  //         | disclosureShare | waitingByWeekOpened
backlog(data, rows): { week: number[], bands: number[][] }
reviewerShare(data, rows, top: number): number
```

**Behaviour:**
- An outcome curve is a cumulative incidence with competing outcomes and
  censoring. Sort the rows by duration. With `S = 1` and `n` at risk, at
  each time with `d_k` outcomes of kind `k`: add `S × d_k / n` to that
  kind's share, then set `S ← S × (1 − Σd_k / n)`. A PR with no outcome yet
  leaves the risk set at its age, measured to `fetched_through`, after the
  outcomes at that same time. The shares and `S` sum to one at every point.
- For `merge` the outcomes are merged and closed unmerged. For `response`
  and `approval` they are the event itself and "finished without one".
- Durations run from `ready` for `response` and `approval`, and from
  `created` for `merge`: the spec's time to merge runs from the opening. A
  row whose start is `-1` is left out. A negative duration is zero.
- `firstCommitToOpened` leaves out rows whose `first_commit` is `-1`.
- Weekly series by calendar week count events; series by week opened use
  only rows with `in_window`. The step is a week for a period of up to 53
  weeks and a calendar month beyond that.
- Bands. Size, by lines added plus deleted: up to 10, 11–100, 101–1,000,
  over 1,000. Author standing, by `standing`: 0 (first PR), 1–9, 10–99, 100
  or more, and unknown for `-1`.
- The backlog at a week's end counts rows open then: opened at or before
  it, and not inside a closed stretch between a `closed` and a `reopened`
  event. Age bands: under 7 days, 7–30, 30–90, over 90.
- `reviewerShare` is the share of human review events made by the `top`
  busiest actors. It returns a number only, never who.

**Tests:**
- Four PRs: merged at day 1, closed at day 2, open at age 3, merged at
  day 5. Merged share is 0.25 from day 1 and 0.75 from day 5; closed is
  0.25 from day 2; the median days to merge is 5. Without the fourth PR
  the median is `null`.
- An empty selection gives empty curves and series, and `null` quantiles.
- A row whose last commit predates its opening gives zero days for
  `openedToLastCommit`; one whose merge predates `ready` gives zero days to
  merge; one whose last commit is after `fetched_through` gives zero days
  for `afterLastCommit`. None gives a negative or NaN value.
- A PR opened Sunday 23:59:59 UTC and one opened Monday 00:00:00 fall in
  different weeks.
- A PR closed in week 2 and reopened in week 4 is out of the backlog in
  week 3 and in it in week 5.
- A selection with every filter at its default equals all rows; each
  filter alone selects the rows a hand count of the fixture gives.
- Property: for random rows, shares are monotone, within [0, 1], and sum
  with `S` to one.

### Task 16: Kind in the site

Runs after Task 8 and before Task 9.

**Files:** `site/src/lib/{data,filters,state,select}.ts`,
`site/src/components/FilterBar.svelte`, the fixture, their tests.

**Behaviour:**
- `data.ts` reads `meta.kinds` and the `kind` column, and checks every
  value is `-1` or inside the dictionary.
- The filter bar gains Kind: all, each kind in `meta.kinds`, and unknown.
  It is kept in the URL like the others; an unknown value falls back to
  all.
- `select` applies it.
- The hand-made fixture gains `kinds` and a `kind` column covering every
  kind and unknown.

**Tests:** the filter round-trips through the hash and an unknown value
yields all; each kind alone selects the rows a hand count of the fixture
gives; a year file with a `kind` outside the dictionary is rejected by
name.

### Task 9: Velocity and Review views

**Files:** `site/src/components/{charts/*,Velocity,Review}.svelte`, tests.

**Behaviour:**
- Shared chart parts (axes, a weekly bar and line chart, a stacked area, a
  step curve) drawn as SVG with `d3-scale` and `d3-shape`. Every chart has
  a text summary for screen readers, a tooltip with exact values, and an
  empty state reading "no PRs match".
- Velocity: PRs per week (opened, stacked disclosed and not disclosed;
  merged; closed unmerged), and the open backlog per week in age bands.
- Review: human reviews and bot reviews per week; people reviewing per
  week; outcome curves for first response, first approval and merge;
  median and 90th percentile waits by week opened, drawn as "not yet
  known" where the curve has not reached them; time after approval; bot
  commands per week by command, with the share of PRs that have one and
  the number a merged PR took; the share of reviews done by the ten busiest
  reviewers, as one figure.
- Spans: first commit to opened, opened to last commit, and last commit to
  final disposition, each as a curve and by week opened. When the target
  filter includes other branches, the first span is labelled "original work
  to backport opened".
- One chart sets PRs arriving, split by disclosure, against human reviews
  done and people reviewing, on a shared time axis.
- Selecting a week or a band sets the selection in the URL.

**Tests:** component tests on the fixture that each chart renders the
series the statistics library returns and shows the empty state for an
empty selection.

### Task 10: LLM-use view, the dot plot and the PR table

**Files:** `site/src/components/{LlmUse,DotPlot,PrTable}.svelte`, tests.

**Behaviour:**
- LLM use: the share of PRs disclosing per week, by family; and disclosed
  against not disclosed, side by side, for size, first commit to opened,
  merge rate, time to merge and bot reviews. A line under the section says
  that "not disclosed" is not "no LLM" and links to the methods page.
- Dot plot, on a canvas so it stays responsive at 75,000 points: each PR a
  dot, opened date across, days to final disposition up on a log scale,
  coloured by disclosure; an open PR is a hollow dot at its age. Hover
  shows the PR's number; click selects it.
- PR table: the PRs of the current selection, virtualised; columns number,
  title, author, opened, state, kind, waits, size, disclosure, reopened;
  sortable; each number links to the PR on GitHub. It loads
  `table-<year>.json` when first shown.
- A selected PR shows an "Open on GitHub" link, its kind and what decided
  it, a link to each tracker ticket it references
  (`https://tracker.ceph.com/issues/<n>`), and, for a backport, a link to
  the PR it backports. These come from the table file.

**Tests:** the side-by-side figures equal the statistics library's for the
two selections; the table shows exactly the selected rows and sorts; a
click on a dot or a row sets the selected PR in the URL.

### Task 11: Timelines

**Files:** `site/src/components/{PrTimeline,Lanes}.svelte`, tests.

**Behaviour:**
- One PR's timeline, as sketched in the spec: first commit, opened, each
  event by kind with the spec's legend, last commit, final disposition, and
  the three spans labelled beneath. An unknown first commit is left off and
  said so. Events show kind and time; Task 17 adds who.
- Lanes: the same line for up to 200 PRs of the current selection, one per
  row, on a canvas; a switch between the calendar and days since opening;
  ordered by opening unless the table is sorted. When the selection is
  larger, a note says how many are shown.

- Every mark on the one-PR timeline is a link to its GitHub page, opened in
  a new tab and named for what it is and when: a comment, a review, a
  commit, and the ready, draft, closed and merged events. A force-push
  links to the commit it pushed, a reopening to the PR. Under the line the
  PR's commits are listed by short SHA, each a link. `data.ts` loads
  `commits` and `refs` from the table file and checks their lengths against
  the rows and the events.
- A PR number in the URL that is not in the data shows "no such PR".

**Tests:** a fixture PR with every event kind renders one mark per event in
time order, each with the address its id or SHA gives; a PR with
`first_commit` unknown renders without it; an unknown PR number shows "no
such PR"; lanes cap at 200 and say so.

### Task 17: People

Runs after Tasks 10 and 11, which it edits. The owner asked for it during
the build.

**Files:** `site/src/lib/{data,filters,state,select}.ts`,
`site/src/lib/stats/people.ts`,
`site/src/components/{People,FilterBar,PrTable,PrTimeline}.svelte`, the
page's section list, their tests.

**Behaviour:**
- `data.ts` reads `meta.people` and `meta.people_bots` and the `author`
  column, and checks every `author` and `actor` is inside `people`.
- `stats/people.ts`, pure, over a selection:
  - authors: one row per author of the selected PRs, with PRs opened,
    merged, closed unmerged and still open; the median days to a first
    response and to merge, from the outcome curves over that author's PRs,
    `null` where not yet known; the share disclosing; lines changed.
  - reviewers: one row per person who reviewed or commented on a selected
    PR they did not open, with PRs reviewed; reviews by verdict; comments;
    first responses given; and the median days from a PR being ready to
    their first response on it.
- A People section with the two tables: every column sortable, ascending
  and descending, by a control a keyboard can reach; virtualised; a `null`
  sorts last either way. Each handle is a link to
  `https://github.com/<login>`, opened in a new tab. Bot accounts are
  hidden until a "show bots" control is set, and marked when shown.
- Two filters, Author and Reviewer, each a handle chosen from the people
  the data names, kept in the URL as the login; an unknown login falls back
  to no filter. `select` applies them: Author keeps the PRs that person
  opened; Reviewer keeps the PRs that person reviewed or commented on
  without being the author. A row's "filter" control sets the matching
  filter.
- The PR table's author is a handle linking to GitHub, with a control that
  sets the Author filter. A mark on the one-PR timeline says who made it
  where the event has an `actor`, the handle a link.

**Tests:** an author's and a reviewer's row hand-computed from the fixture;
sorting by each column both ways with a `null` last; the filters round-trip
through the hash and an unknown login yields none; the Reviewer filter
selects exactly the hand-counted PRs; a handle's address; bots hidden by
default; a year file whose `author` is outside `people` is rejected by
name.

### Task 12: Methods page

**Files:** `site/src/content/methods/*.md`, the prose route.

- [ ] One section per definition in the spec, each stating the rule the
  code applies. Figures come from the data, not retyped.
- [ ] What disclosure can and cannot show; that Ceph's trailer rule was a
  draft on 2026-10-12; that a backport's disclosure describes the original
  work.
- [ ] What six months cannot show: no pre-LLM baseline, and unknown author
  standing for PRs opened before the window.
- [ ] The hand-edited tables, linked to their files in the repository.
- [ ] What an author's and a reviewer's row counts, that a bot command is
  not a review, and which accounts are treated as bots.
- [ ] How a PR's kind is decided, how many PRs each source decided and how
  many are unknown, computed from the data; that a ticket's type is the
  tracker's and may be wrong; and that the tracker lists the motion on the
  trailer rule as defeated.
- [ ] How to check a number: the PR table and the links to GitHub. What
  links where, and that a reopening has no address of its own.
- [ ] Every claim about the code's behaviour is checked against the code
  before it is written.

### Task 13: Release and deploy

**Files:** `.releaserc.yml`, `.github/workflows/{release,deploy}.yml`,
`site/e2e/smoke.spec.ts`, `site/playwright.config.ts`.

- [ ] Mirror the sibling's `release.yml`, `deploy.yml` and `.releaserc.yml`,
  substituting this repository's names and build.
- [ ] Browser smoke test against `vite preview` on the committed data: the
  page loads with no console errors; changing the target filter changes a
  headline figure; selecting a week narrows the table; opening a PR shows
  its timeline; a hash with an unknown filter value loads defaults; the
  footer shows a version and the repository link; a mark on the timeline
  links to that PR on github.com; sorting the reviewers table by a column
  reorders it, and a handle links to github.com; the methods page renders.
  Wire it into CI.
- [ ] Enable Pages with source "GitHub Actions"; allow the `github-pages`
  environment to deploy from `v*` tags.
- [ ] Merge; watch release, then deploy, with one background watcher.
- [ ] Verify the live site: HTTP 200, the footer's version equals the
  latest tag, the smoke test passes against the Pages URL.
- [ ] Check in with the owner: the URL, what the six months show for the
  three questions, and what the full history would add.

---

## Order

```
1 ─┬─ 2 ─ 3 ─┬─ 14 ─┬─ 4 ─ 5 ─ 6 ─────────┐
   │         └─ 15 ─┘                     ├─ 13
   └─ 7 ─ 8 ─ 16 ─ 9 ─┬─ 10 ─┐            │
                      └─ 11 ─┴─ 17 ─ 12 ──┘
```

The Go line (2–6, with 14 and 15 after 3) and the site line (7–11, with 16
after 8) run side by side. Tasks 14 and 15 both extend the record and
`extract`, in different fields; the second to merge rebases. Task 10 needs
Task 9's shared chart parts; Tasks 10 and 11 are independent of each other.
Task 17 edits the table and the timeline, so it follows both. Task 13 needs
all of them.

## Self-review notes

- Spec coverage: measures and stages (6, 8, 9); backports as a category (4,
  7); first commit to opened, last commit and the three spans (3, 6, 8, 11);
  disclosure and tool families (3, 4, 5, 10); bot commands as a category
  (4, 5, 9); plots over time and the dot plot (9, 10); timelines and
  reopening (3, 6, 8, 11); drill-down table and linked views (7, 10); one
  command to update (5); public from the first release with the methods
  page (12, 13); named-people rules (6, 8, 9, 11).
- The spec leaves the estimator of the outcome curves to the builder; this
  plan fixes it (Task 8) because Tasks 9 and 10 depend on its shape.
- The spec leaves author standing's source to the builder; this plan takes
  a per-author baseline at the window start (Tasks 2, 3) and marks older
  PRs unknown. The full history removes the baseline.
- Sorting by author and by reviewer was asked for by the owner during the
  build, with people shown and linked by GitHub handle: Task 6 ships the
  logins, Task 17 adds the tables and the two filters, Task 12 explains the
  figures. It replaces a rule of the builder's against ranking named
  people.
- The kind of change was added by the owner during the build, with the
  tracker as a source: Task 15 gathers the hints and the ticket types,
  Task 4 decides, Task 6 ships the column, Task 16 filters on it, Task 10
  shows it and Task 12 explains it.
- Links back to GitHub were added by the owner during the build: Task 14
  carries the identifiers through fetch and extract, Task 6 ships them,
  Tasks 10 and 11 draw the links, Tasks 12 and 13 document and test them.
- Not in this plan, as in the spec: the full history, a QA stage from label
  history, a scheduled refresh.
