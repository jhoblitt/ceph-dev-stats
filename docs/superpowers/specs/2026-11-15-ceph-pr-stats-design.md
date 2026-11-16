# Ceph pull-request statistics — design

Date: 2026-11-15. Status: approved by the owner 2026-11-15.

## Intent

Give Ceph developers an interactive page over `ceph/ceph` pull requests that
answers three questions, each about change over time:

1. **Velocity** — how much work arrives, lands and is abandoned.
2. **LLM use** — is disclosed LLM assistance changing how PRs are written and
   handled?
3. **Review** — has human review become the bottleneck?

The owner's working thesis is that human review has not kept up with
LLM-generated PRs, as in most open source projects. The page exists to show
the evidence for or against that, not to assume it.

It is built like its sibling, `jhoblitt/ceph-porting-estimate`: a Go tool
produces the data, a static site renders it and computes in the browser,
GitHub Pages publishes it.

## Goals

- For every PR: time to first response, time to merge, time to close
  unmerged, and time from first commit to PR opened.
- Whether LLM use is disclosed, in the PR description or in commit messages,
  and with which tool.
- Plots over time for every measure, and each PR plotted individually.
- A timeline for a PR: its first commit, its opening, each comment, bot
  command and review, its last commit, any closing and reopening, and its
  final disposition.
- Bot commands, the comments that only trigger automation, counted as their
  own category.
- Links from everything on the page back to GitHub: the PR, each comment,
  each review, each commit, and each lifecycle event GitHub gives an
  address.
- Each PR's kind, where it can be told: bug fix, feature, cleanup or
  documentation.
- Drill-down: filters that recompute everything, and a table of the PRs
  behind the current selection, each linking to GitHub.
- Easy to update: one command refreshes the data.
- A first version over six months of PRs that the owner can look at before
  any decision to process the full history, and that needs no redesign to
  take the full history (about 74,000 PRs).

## Non-goals

- Measuring effort or hours. Every duration is elapsed calendar time.
- Detecting undisclosed LLM use.
- A stage for QA runs taken from label history. Time after approval is
  reported as one stage in the first version.
- A scheduled, automatic refresh.
- Repositories other than `ceph/ceph`. From tracker.ceph.com only a
  ticket's type is read, and nothing else.
- The full history, and the pre-LLM baseline it would give. Six months shows
  the current state and its trend only.

## Anti-goals

- Calling a PR "human-written". The page knows only "disclosed" and "not
  disclosed".
- Durations computed from finished PRs only, as if the unfinished ones did
  not exist.
- Backports mixed into the first-commit measure, where a cherry-pick's
  original date would read as months of development.
- Derived statistics committed to the repository, where they can drift from
  the records that produced them.

## Decisions made by the owner

- **Measures**: time open before a response in comments, time open before
  merge, time open before closing unmerged, and first commit to PR opened as
  an estimate of development time against waiting time.
- **Backports** are their own category, with the option to exclude them.
- **First commit to PR opened** is kept for every PR, values under an hour
  included: a short gap is plausible with an LLM and is informative.
- **LLM disclosure** in the PR description or the commit messages is part of
  the analysis.
- **Audience**: developers trying to understand project velocity, whether
  LLM use is changing behaviour, and whether review is now a serious
  bottleneck.
- **First dataset**: every PR opened in the last six months. A page comes
  before any processing of the full history.
- **Plots of PRs over time.**
- **Bot commands are their own category**, tracked and shown.
- **A timeline for PRs** with the first commit, the last commit, the PR's
  opening, comments and bot commands, and the time of the final disposition.
- **Closed and reopened**: the page says whether a PR was closed and then
  reopened. The owner asked for this as a bonus.
- **Authors and reviewers by name** (added 2026-11-15, during the build):
  the page sorts and filters by author and by reviewer, shows people by
  their GitHub handle, and links each handle to its GitHub page. The
  builder had proposed the opposite, that nothing rank named people; the
  owner never asked for that and overruled it.
- **Feature or bug fix** (added 2026-11-15, during the build): besides
  marking backports, the page tries to say whether a PR is a feature or a
  bug fix. The owner chose to read ticket types from tracker.ceph.com for
  it, which this design had ruled out.
- **Links back to GitHub** (added 2026-11-15, during the build): the corpus
  includes what links a PR, its comments, its commits and the rest to their
  GitHub pages, so a reader can drill all the way down to the GitHub UI.
- **Approach A** (below): the browser computes the statistics from per-PR
  data.
- **Model**: similar to `jhoblitt/ceph-porting-estimate`.
- **Repository** is public, `jhoblitt/ceph-dev-stats`. The owner granted
  the same permission as on the sibling: to create and configure it, open
  PRs and merge them once CI is green, and manage its CI, checking in at
  milestones such as the first viewable page.
- **Publishing**: the page is public from the first release, as the
  sibling's is. There is no private review step before it.

## Decisions made by the builder (open to correction)

- **The pull covers every PR active in the window**, not only those opened
  in it: every PR updated since the window's start, plus every PR still
  open. Charts by calendar week (reviews done, backlog) need the older PRs
  that were still being worked on; charts by week opened use only PRs opened
  in the window. A PR open at any moment in the window is either still open
  or was closed, and so updated, inside it, which makes the backlog exact
  across the window.
- **A response is human.** First response is the earliest comment or review
  by a person other than the PR's author. Bot comments and bot reviews are
  recorded and shown as their own measure.
- **A bot command is not a response.** A comment that only triggers
  automation (`jenkins test …`, `/audit retest`, `/config check ok`) counts
  as neither a response nor a review, whoever wrote it. The commands are a
  hand-edited list, because a first pattern missed several (see
  Measurements), and the methods page says so.
- **Every comment has a kind**: by another person, by the author, a bot
  command (from the author or from someone else), or from a bot account.
  The site carries each event's time and kind, and for a comment or a
  review by a person, who made it.
- **Last commit is the latest committer date** among the PR's commits,
  where first commit is the earliest author date. Squashing a fix into an
  existing commit keeps its author date and moves its committer date, and
  the author date alone misses most changes made after opening (see
  Measurements). A rebase moves the committer date too, so "last commit"
  marks the last time the code changed for any reason.
- **Three spans** fall out of the timeline and are measures of their own:
  first commit to opened, opened to last commit, and last commit to final
  disposition. The last is the wait after the code stopped changing.
- **History rewrites are shown** on the timeline: each force-push, at the
  time it happened.
- **Two timeline views**: one PR in full when it is selected, and the PRs
  of the current selection as stacked lanes, capped at a number the page
  can draw.
- **Reopened PRs**: the final disposition is the last close or merge, and
  time to merge or close runs from the opening to it. A PR is not in the
  backlog while it was closed. "Was reopened" is a filter and a column.
- **A PR's kind comes from three sources, in an order a table sets.** The
  PR's own checklist counts when its ticks agree on one kind; then the type
  of the first tracker ticket it references; then a kind label. A backport
  takes the kind of the PR it names when that PR is in the data, else its
  ticket's. The record keeps the hints, not the verdict, and the mapping
  and the order are a hand-edited table, so either can change without a new
  pull. A PR none of the three says anything about is "unknown", and the
  page shows how many are.
- **Identifiers are stored, not addresses.** A record keeps each comment's
  and review's GitHub id, each commit's SHA and each lifecycle event's id,
  and the page builds the address from them. A stored address would add
  about 70 bytes to every event for nothing the identifier does not give.
  A reopening has no address on GitHub and links to the PR; a force-push
  links to the commit it pushed.
- **Stages**: opened → first human response → first human approval → merged.
  Time after approval is reported separately so QA is not counted as review.
- **Drafts**: a PR is not waiting for review while it is a draft. The waiting
  clock starts when the PR was opened, or when it was first marked ready if
  it was opened as a draft; a response that came earlier counts as no wait.
  A PR that has never been ready is left out of the waiting measures and
  kept in the volume charts.
- **A person's figures use the page's own definitions.** An author's row
  is computed over the PRs they opened; a reviewer's over the reviews and
  comments they made on other people's PRs. Bot accounts are listed apart
  from people, so a bot never tops a table of reviewers.
- **Unfinished PRs count.** Durations are shown as outcome curves (below),
  not as averages over finished PRs.
- **PR size and author standing are recorded**, so like can be compared with
  like: a disclosed-versus-undisclosed comparison is confounded by both.
- **Site data is stored as columns, split by year**, with titles loaded only
  when the PR table opens (see Measurements).
- **Weekly steps** for time plots over a six-month range; the step widens as
  the range does.
- **Updating is a command run by hand**, followed by a commit.
- **Look**: the sibling's site shell, styling, themes and footer.
- **Repository, CI, release and deploy** follow the sibling.
- **Names**: binary `cephstats`, environment prefix `CEPHSTATS_`.

## Measurements behind these decisions

All taken from `ceph/ceph` through the GitHub GraphQL API on 2026-11-15.

| Fact | Value |
|---|---|
| PRs in total | 73,890: 58,332 merged, 13,539 closed unmerged, 2,019 open |
| Opened since 2026-05-15 | 4,985, of which 3,482 target `main` and 314 are drafts now |
| Updated since 2026-05-15 | 6,242 |
| Open, and opened before 2026-05-15 | 231 |
| API cost | 2 rate-limit points per page of 50 PRs with 100 commits, 30 comments and 30 reviews each; the hourly allowance is 5,000 |
| Raw response size | about 7.4 KB per PR with its description and commit messages |

The 100 newest PRs (opened over 3 days):

- 91 open, 3 merged, 6 closed: too new to say anything about merge time.
- 38 target a branch other than `main` (`umbrella`, `tentacle`, `squid`).
  Their earliest commit is a median of 35–46 days older than the PR, and up
  to 815 days.
- Of the 62 to `main`: 41 are a single commit, 34 have a first commit under
  an hour before opening, and 4 have an earliest commit dated after the PR
  opened.
- Every PR carries labels: components (`rgw`, `core`, `cephfs`, …) and
  process states (`needs-review`, `needs-qa`, `wip-*-testing`,
  `needs-ci-approval`, `DNM`, …).
- 18 have a review from a bot (`github-actions`, `copilot-pull-request-reviewer`);
  21 have a review from a person other than the author.
- Authors comment on their own PRs often, so "first comment" is not "first
  response".

PRs opened 2026-05-11 to 2026-05-14 (82), most of them finished:

- 80 finished; the median merge took 15.9 days and the 90th percentile 99.8
  days.
- 9 comments and 4.5 reviews per PR on average, at most 35 and 59.
- Of 742 comments: 372 by another person, 156 by the author, 80 from bot
  accounts (`github-actions`, `dependabot`), and 134 bot commands by a first
  pattern, 77 of them from the PR's author. 44 PRs have at least one.
- The commonest commands: `jenkins test windows`, `jenkins test make check`,
  `jenkins test make check arm64`, `jenkins test pr`, `jenkins test api`,
  `jenkins retest this please`, `/audit retest`. Comments that look like
  commands and that the pattern missed: `jenkins ceph-volume unit tests`
  (14), `/audit override` (6), `ok to test` (3).
- 2 PRs were closed and reopened. 50 were force-pushed at least once, one of
  them 41 times. 10 have a draft event.
- Of the 52 merged to `main`, the last commit falls after the opening on 41
  by committer date and on 18 by author date. The median merge came 5.1 days
  after the last commit by committer date (90th percentile 28.8), and 13.9
  days after opening.

The 300 newest PRs (opened over 8 days), for disclosure:

- 88 carry an `Assisted-by:` trailer on at least one commit; 16 name an AI
  in `Co-authored-by:`; up to 113 disclose somewhere once descriptions
  count; 8 disclose in the description only.
- The trailer's value is free-form: more than 30 spellings, among them
  `Claude Code`, `claude-code:claude-opus-4-6`, `LLM`, `IBM Bob 2.3.0`,
  `Codex (GPT-6)`, `Gemini`, `Cursor <cursoragent@cursor.com>`. Near misses
  occur: `Assistant-By:`, `Claude-Session:`, and prose such as "Assisted by
  Claude Opus-5.5".
- Description forms seen: "Assisted by Claude Code (…)", "🤖 Generated with
  [Claude Code](…)", "🤖 Raised by [Claude Code](…)", "Disclosure: … prepared
  with the help of Claude Code", "I made this fix with an LLM".
- A tool's name alone is not a disclosure: one PR adds a Copilot review
  skill, and one commit reads "Address Copilot review comments".
- 21 of the 84 PRs to other branches carry `Assisted-by:`, inherited from
  the commits they cherry-pick.
- On `main`, 40 of 82 disclosed PRs had a first commit under an hour before
  opening, against 86 of 134 undisclosed; one author opened 31 of those 134.
- Ceph's rule asking for the `Assisted-by:` trailer was a draft on
  2026-10-12 (Steering Committee motion, tracker issue 79745), so disclosure
  is voluntary and uneven.

A benchmark of 100,000 synthetic PRs and 400,000 review events in Node 22,
on a desktop:

| Layout | Raw | Gzip | Parse |
|---|---|---|---|
| One object per PR | 36.7 MB | 4.7 MB | 146 ms |
| Columns of numbers, PRs | 6.1 MB | 2.1 MB | 32 ms |
| Columns of numbers, review events | 7.8 MB | 3.2 MB | 24 ms |

Over those columns: a filter takes 1 ms, a median and 90th percentile 9 ms,
an outcome curve 26 ms, distinct reviewers per month 20 ms. Real titles
average 62 characters and compress to about 41% of their size. Not measured:
a browser, a phone, and the real number of reviews per PR.

Observed while probing: a PR's commits, comments and reviews each need
their own paging (one PR had 219 commits, others 41 reviews); the
timeline's `totalCount` ignores the event-type filter, while the events
returned respect it; and one request for 100 PRs with comment text,
reviews, commits and events came back empty, where pages of 20 succeeded.

Addresses, read from #69877 and #68904: a comment is
`…/pull/N#issuecomment-<id>`, a review `…/pull/N#pullrequestreview-<id>`, a
commit `…/pull/N/commits/<sha>`, and a marked-ready or closed event
`…/pull/N#event-<id>`; merged and converted-to-draft events expose the same
field. A force-push carries the commits before and after it. A reopening
carries no address.

Kind, counted on 2026-11-15 over the 3,477 PRs to `main` opened in the
window: 1,255 state a kind themselves, by a checklist box other than
"References tracker ticket" or by a kind label; 2,198 reference a tracker
ticket; 3,089 do one or the other, and 388 neither. Of 1,503 PRs to other
branches, 1,378 name the PR they backport or a ticket. The PRs reference
4,008 distinct tickets. The tracker answers `…/issues/<id>.json`
anonymously with the ticket's type, one of: Bug, Enhancement, Feature,
Support, Cleanup, Tasks, Documentation, Subtask, Backport, QA Run, QA
Review, Motion, Election, Assignment, Working Group, Ceph Release.

The tracker lists the Steering Committee motion on the trailer rule (issue
79745) as "Defeated", as read on 2026-11-15.

## Constraints

- GitHub Pages serves static files only: data is produced before the build,
  statistics in the browser.
- Go for the tool, TypeScript for the browser; committed shell is thin glue.
- The GitHub token comes from the environment and is never written to disk
  or committed. Tests never call the live API.
- Raw API responses are too large to commit and stay in a local cache. What
  is committed must be enough to rebuild the site and to re-apply every
  hand-edited table (disclosure, bot commands, bot accounts, labels)
  without fetching again.
- All times are UTC.
- The refresh trusts GitHub's last-updated time. Which changes move it
  (comments, reviews, pushes, labels, closing) must be confirmed before the
  refresh is relied on, and a full re-pull must stay cheap as the fallback.
- Workflows follow the github-conventions canon.
- Requests to tracker.ceph.com are anonymous, sequential and batched, name
  the tool and nothing about its user, and ask for each ticket once: a
  ticket's type is kept and not asked for again.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A (chosen) | The tool writes one compact record per PR; the site loads them and computes every figure under the current filters | Any filter combination and the PR table behind any number; the page downloads all records, which needs a compact layout at full history |
| B | The tool computes the series for slices chosen in advance; the page only draws | Smallest and fastest page; only the combinations chosen ahead, and no PRs behind a number |
| C | DuckDB compiled to WebAssembly runs SQL in the browser over a Parquet file | Any question is a query; a 34 MB engine before compression, SQL in the page, and a stack unlike the sibling's |

The owner chose A after the benchmark above showed 100,000 PRs is small for
it: the full history is about 5 MB compressed, less than C's engine alone.

## Definitions

**Target.** `main`, or another branch. Any other branch is "backports and
other branches"; the tool lists the branches it saw so an odd one is
noticed.

**Human.** An account GitHub does not type as a bot and that is not on the
hand-edited list of bot accounts.

**First human response.** The earliest issue comment or review, inline
review comments included, by a human other than the PR's author. A comment
that is only a bot command does not count.

**First human approval.** The earliest approving review by a human other
than the author.

**Waiting clock.** As under Drafts above.

**First commit to PR opened.** The PR's opening time minus the earliest
author date among its commits. The author date, not the committer date: it
survives rebase and amend. When that date is after the opening the history
was rewritten and the value is unknown, not negative. Shown for `main` by
default; for other branches it measures how long after the original work
the backport was opened, and is labelled so.

**Size.** Lines added plus lines deleted, and files changed, in bands.

**Author standing.** How many PRs the author had opened in `ceph/ceph`
before this one, in bands (first, 2–10, 11–100, more). GitHub's own
association field describes the author today, not at the time of the PR, so
it is recorded only as a secondary column.

**Component.** Taken from labels through a hand-edited table that says
which labels are components, which are process states, and which are
neither. A PR with two component labels belongs to both.

**Disclosure.** One of: trailer (`Assisted-by:` in any case, on any
commit), co-author (an AI named in `Co-authored-by:`), description only, or
none. The matched text is kept with the PR's record. A hand-edited table
maps each spelling to a tool family; an unmapped spelling is reported, not
dropped. A description counts only when it uses disclosure phrasing, never
on a tool's name alone. On a backport, disclosure describes the original
work.

**Review event.** One review: the PR, the reviewer, the time, the verdict,
and whether the reviewer is human. These feed the calendar charts.

**Bot command.** A comment whose whole text is a command to automation,
matched against the hand-edited list and recorded under the command's name.

**Comment kind.** In this order: from a bot account; a bot command, from
the PR's author or from someone else; by the PR's author; by another
person.

**Last commit.** The latest committer date among the PR's commits.

**Lifecycle event.** Marked ready, converted to draft, history rewritten
(a force-push), closed, reopened, merged, each with its time.

**Final disposition.** Merged or closed unmerged, at the time of the last
such event; none while the PR is open.

**Reopened.** The PR has at least one reopening; how many is recorded.

**Backlog at a moment.** PRs open at that moment: opened at or before it,
and not inside a closed stretch.

**Reviewer.** A human who reviewed or commented on a PR they did not
open. A bot command is not a review, as it is not a response.

**Kind.** Bug fix, feature, cleanup, documentation, other, or unknown. The
checklist boxes "New feature", "Very recent bug", "Doc update" and "Code
cleanup" each name one. A ticket's type names one: Bug is a bug fix,
Feature and Enhancement a feature, Cleanup a cleanup, Documentation
documentation, and the rest other; a Backport ticket stands for the ticket
it was copied from. The labels `bug-fix`, `feature` and `cleanup` each name
one. Which source wins is the table's order.

## Statistics

- **Outcome curves.** For PRs opened in a period: by day N, the share
  merged, the share closed unmerged and the share still open, summing to
  one. A PR younger than N days counts only up to its age, and merging and
  closing compete. The same form serves first response and first approval.
  Medians and percentiles are read from the curve, and shown as "not yet
  known" when the curve has not reached them.
- **By week opened**: the waiting measures of the PRs opened that week.
- **By calendar week**: PRs opened, merged and closed; human reviews, bot
  reviews and distinct human reviewers; the backlog and its age bands.
- **Bot commands**: per calendar week by command, the share of PRs with at
  least one, and how many a PR took before it merged.
- **Spans**: the three spans of the timeline, as outcome curves and by week
  opened.
- **Comparisons** (disclosed against not, by size, by standing) are the same
  statistics over two selections, side by side.

## The page

```
┌───────────────────────────────────────────────────────────────┐
│ Ceph pull requests              data as of 2026-11-15         │
│ Period ▾  [main|backports|all]  Component ▾  Size ▾           │
│ Author standing ▾   Disclosure ▾   Drafts ▾   Reopened ▾      │
│ Kind ▾   Author ▾   Reviewer ▾                                │
├───────────────────────────────────────────────────────────────┤
│ Velocity                                                      │
│   PRs per week: opened (disclosed / not) · merged · closed    │
│   Open backlog per week, in age bands                         │
├───────────────────────────────────────────────────────────────┤
│ Review                                                        │
│   Reviews per week: human · bot      People reviewing per week│
│   Outcome curves: first response · approval · merge           │
│   Waiting by week opened: median and slowest tenth            │
│   Time after approval · time after the last commit            │
│   Bot commands per week, by command                           │
├───────────────────────────────────────────────────────────────┤
│ LLM use                                                       │
│   Share of PRs disclosing per week, by tool                   │
│   Disclosed against not: size · first commit to opened ·      │
│     merge rate · time to merge · bot reviews                  │
├───────────────────────────────────────────────────────────────┤
│ Each PR as a dot: opened → days to merge, by disclosure       │
│ Timelines: the selected PRs as stacked lanes                  │
│ People: authors · reviewers, each a table sortable by column  │
│ Table: # · title · author · opened · state · waits · size     │
│ One PR: its full timeline (below)                             │
├───────────────────────────────────────────────────────────────┤
│ Methods                         v1.2.3 · repository link      │
└───────────────────────────────────────────────────────────────┘
```

- Every filter recomputes every chart and the table.
- Selecting a week, a band or a dot narrows the table to those PRs; each row
  links to the PR on GitHub.
- Every PR, comment, review, commit and addressable lifecycle event shown
  links to its page on GitHub.
- A PR shows its kind and what decided it, links to the tracker tickets it
  references, and, for a backport, links to the PR it backports.
- Authors and reviewers each have a table with one row per person and one
  column per figure, sortable by any column. A handle links to that
  account on GitHub, and choosing a person filters the whole page to the
  PRs they opened or reviewed.
- Filters and the selection live in the URL, so a view can be linked.
- The central chart for the thesis sets PRs arriving, split by disclosure,
  against human reviews done and the people doing them.
- A methods page states each definition above, what disclosure can and
  cannot show, and what a six-month window cannot show.

One PR's timeline, opened from the table, a lane or a dot:

```
#NNNNN rgw: title of the pull request      main · 3 commits · disclosed

first commit    opened                            last commit      merged
     ●────────────◆──■──▲───△──▲──────✔──■──↻───────●─────────────────★
  May 2         May 9                             May 21           Jun 3
     └─ before opening ─┘└────── opened to last commit ──────┘└─ after ─┘

▲ comment by another person   △ author comment   ■ bot command
□ bot account   ✔ approval   ✖ changes requested   ↻ history rewritten
◇ marked ready   ○ closed   ◐ reopened   ★ merged
```

The stacked lanes draw the same line for many PRs at once, one per row,
against the calendar or against days since opening.

## Data flow

1. **Fetch.** Walk PRs from the most recently updated back to a start date,
   then add every open PR not yet seen, and keep the raw responses in a
   local cache. The first pull's start date is six months back; a refresh's
   is the previous pull's, with an overlap. The data accumulates: the
   window's start does not move forward as time passes.
2. **Extract.** Turn each cached PR into one compact record: its times,
   target, size, author, labels, first and last commit, review events,
   comment events with what is needed to classify them, lifecycle events,
   the identifiers that link each of these to GitHub, and the disclosure
   text matched. Records are committed as text, one PR per line,
   grouped by the month the PR opened, so a refresh rewrites only the months
   that changed.
3. **Tickets.** Read from tracker.ceph.com the type of every ticket the
   records reference and do not yet know, and commit the result.
4. **Check.** Validate the hand-edited tables against the records, and
   report unmapped disclosure spellings, labels no table classifies,
   frequent commenters that look like bots, and frequent short comments
   that look like commands.
5. **Roll up.** At site build, apply the tables and write the site's data:
   columns per year, the events of each PR (about 19 per PR in the May
   batch), and titles apart. This is build output
   and is not committed.

Hand-edited tables: tool families, bot accounts, bot commands, label
classes, and what makes a PR which kind.

## Repository, release and deploy

The repository is `jhoblitt/ceph-dev-stats`, public, and the page is served
from its GitHub Pages site. As the sibling: PRs run CI (Go tests and lint,
the data check, the site's unit tests and build); a merge to `main` cuts a
semantic version and deploys the site to GitHub Pages; the footer shows the
version. A data refresh is user-visible content and cuts a release.

Because the page is public from the first release, the methods page and the
"disclosed / not disclosed" wording ship with the first version that shows
any PR data, not after it.

## Verification

- **Fetch and extract**: unit tests over recorded API responses, including a
  PR with more commits, comments and reviews than one page holds, a
  backport, a draft made ready, a rewritten history, a PR closed and
  reopened, bot commands from the author and from someone else, and each
  disclosure form listed under Measurements.
- **Counts**: after a pull, the number of PRs opened in the window and the
  number open agree with GitHub's own counts for the same moment.
- **Statistics**: hand-computed cases; invariants that the outcome shares
  sum to one and that an empty filter equals the whole.
- **Spot check**: a sample of PRs compared by hand with their GitHub pages.
- **Site**: a build in CI, and a browser smoke test that the page loads, a
  filter recomputes, and a selection narrows the table.

## Left to the builder

- The extract's exact fields and the site data's exact layout.
- The disclosure phrases and bot commands beyond those listed, and the
  first contents of the hand-edited tables.
- How many lanes the stacked timelines draw, and in what order.
- How prior PR counts are obtained for author standing while the dataset
  holds only six months.
- The size, age and standing bands.
- Chart types and visual detail within the sibling's look.
- How the outcome curves are estimated, within the rules under Statistics.

## Later

- The full history, and with it the pre-LLM baseline and the question of
  whether extracted records for 74,000 PRs still belong in git.
- A QA stage from label history.
- A scheduled refresh.
