# What depends on the repository

A registry of every rule, value and assumption in this tool that holds for
ceph/ceph and would not hold, or would hold differently, for another
repository. It is one input to a possible generic tool configured per
repository: each entry is something such a tool would have to take as
configuration, or detect, rather than hard-code.

Each entry says what varies, how ceph/ceph does it, where the rule lives in
this tree, and how it was found. "Where" names a file, not a line, since
lines move. The entries were checked against the tree at v1.8.0, and the
figures are those of the data fetched through 2026-11-16. Add an entry
whenever a change makes the tool fit Ceph in a way it would not fit another
project.

## Identity and history

### Repository identity
- **Varies:** the repository's owner and name.
- **ceph:** `ceph/ceph`.
- **Where:** `internal/fetch/fetch.go` (`Owner`, `Name`).
  `internal/extract/run.go` and `internal/rollup/rollup.go` write them into
  `data/meta.json` and the site's `meta.json` as `repo`, and the site builds
  every GitHub address from that (`site/src/lib/links.ts`,
  `site/src/lib/table.ts`). The name is spelled again in
  `internal/extract/hints.go` (the backport pattern) and in the commands'
  help text (`internal/cli`).
- **Found:** searching the tree for the name.

### Window start
- **Varies:** the first day of the data window.
- **ceph:** 2011-09-01, the day GitHub says the repository was created, so
  the window is the whole history.
- **Where:** `internal/fetch/fetch.go` (`WindowStart`).
- **Found:** the repository's `createdAt`.

### Names of the tool and the page
- **Varies:** binary, environment prefix, module path, Pages base path, page
  title, theme storage key, the footer's repository link, the tracker
  client's User-Agent.
- **ceph:** `cephstats`, `CEPHSTATS_`, `github.com/jhoblitt/ceph-dev-stats`,
  `/ceph-dev-stats/`, "Ceph pull requests", `ceph-dev-stats:theme`,
  `cephstats/<version>`.
- **Where:** `go.mod`, `cmd/cephstats`, `internal/cli`, `Makefile`,
  `internal/tracker/client.go`, `site/vite.config.ts`,
  `site/playwright.config.ts`, `site/index.html`, `site/package.json`,
  `site/src/App.svelte`, `site/src/components/Header.svelte`,
  `site/src/routes/Report.svelte`, `site/src/lib/version.ts`,
  `site/src/lib/theme.ts`.
- **Found:** searching the tree for the name.

### Size of the history
- **Varies:** how many pull requests the whole history holds, and so whether
  the page can open on all of it.
- **ceph:** 73,918 pull requests. A whole-history walk fetched about 63,500
  of them in 4.9 hours; the cache is 673 MB and the committed records
  138 MB. The report opens on the whole window.
- **Where:** a deployment decision; the default period is
  `site/src/lib/state.ts` (`defaultFilters`).
- **Found:** measured.

### Count source for the completeness check
- **Varies:** whether GitHub's listing total or its search count is the
  reference for "every pull request opened in the window is here". The
  listing counts the whole repository, so it serves only a window that
  starts at or before the repository's creation.
- **ceph:** the listing. GitHub's search returned 72,447 pull requests opened
  in the window where the listing held 73,914: it leaves pull requests out,
  mostly from 2013 to 2016.
- **Where:** `internal/fetch/fetch.go` (the counts at the end of a walk),
  `internal/classify/check.go` (the comparison), `data/meta.json`
  (`opened_in_window_source`).
- **Found:** `check` failed on data that was complete.

### Reviews recorded from
- **Varies:** nothing per repository: GitHub announced pull-request reviews
  on 2016-09-14 and holds none before. A repository created earlier has an
  early stretch with comments and no reviews.
- **ceph:** five years of it. The earliest review in the records is on
  2016-09-29. The report says so once, above its sections, when the period
  starts before that day.
- **Where:** `site/src/lib/review.ts` (`REVIEWS_RECORDED_FROM`),
  `site/src/content/methods/limits.md`.
- **Found:** the whole-history data.

### Deleted accounts
- **Varies:** how many pull requests belong to accounts GitHub has deleted,
  and whether the project wants them told apart.
- **ceph:** 1,353 pull requests have no author. 1,351 are credited to the
  name on their commits, 33 names in all, shown as "(deleted) Name"; the
  rest, and every comment and review by a deleted account, are pooled as
  "(deleted, unknown)". The naming rule itself is not Ceph's: the most
  common committer name, GitHub's own web committer aside, and never an
  address.
- **Where:** `internal/fetch/names.go`, `internal/record/record.go`,
  `internal/rollup/rollup.go`, `site/src/lib/handles.ts`,
  `site/src/components/People.svelte`.
- **Found:** the whole-history data, where 1,353 pull requests have no
  author.

## Branches

### Development branch names
- **Varies:** the name or names of the development branch over time.
- **ceph:** `master` until its rename in 2022, `main` since; both count as
  the development branch. The records hold 33,057 pull requests on `master`
  and 17,229 on `main`. The last one opened on `master` is from 2022-07-12,
  and some opened before the rename are now on `main`.
- **Where:** `site/src/lib/filters.ts` (`DEVELOPMENT_BRANCHES`, `TARGETS`,
  `MAIN_TARGET_NOTE`, `baseNote`), `site/src/lib/state.ts` (the default
  target; the target id `main` appears in shared addresses),
  `site/src/content/methods/kind.md`. Nothing in the Go code depends on it.
- **Found:** under the `main` target the whole history left out every pull
  request on `master`.

### Release and other branches
- **Varies:** what the branches other than the development branch are
  called, and how many there are.
- **ceph:** 153 base branches in the records: stable branches named by
  release code name (`reef`, `squid`, `quincy`, `pacific`, …), and feature
  and `wip-*` branches.
- **Where:** nothing matches on a name: any branch other than the
  development branch is "backports and other branches", and the Branch
  filter offers whatever the data holds (`site/src/lib/filters.ts`,
  `site/src/components/FilterBar.svelte`).
- **Found:** counting base branches in the records.

## Backports

### How a backport names its original
- **Varies:** where a backport says which pull request it copies.
- **ceph:** the description says "backport of" followed by the original's
  ceph/ceph address, bare or as a Markdown link, or by `#N`; the first one
  named counts. 10,219 of the 23,632 pull requests off the development
  branch carry it. The line is a convention of recent years: on `jewel`,
  9 of 1,348 do, so a pull request without it can still be a backport.
- **Where:** `internal/extract/hints.go` (`backportOf`, which spells
  `github.com/ceph/ceph`), `internal/rollup/year.go` (the `backport_link`
  column), `site/src/lib/filters.ts` and `site/src/lib/select.ts` (the
  Backport link filter), `site/src/lib/timeline.ts` and
  `site/src/lib/review.ts` (the wording).
- **Found:** sampling pull requests on release branches.

### Who makes a backport, and what its commits carry
- **Varies:** whether people or a bot open backports, and whether the copied
  commits keep their dates and authors.
- **ceph:** people, by cherry-pick. The commits keep their authors and
  author dates and gain a "(cherry picked from commit …)" line, so a
  backport's first commit is the original work's, and its committer, not
  its author, is who made the backport.
- **Where:** `internal/extract/disclosure.go` (the cherry-pick line and the
  Conflicts paragraph after it are not read for disclosures),
  `internal/fetch/names.go` (committers before authors),
  `site/src/content/methods/commits.md`.
- **Found:** the first-commit-to-opened span, which on a backport starts at
  the original work.

### Backport tickets
- **Varies:** whether a backport has a ticket of its own, and what that
  ticket says about the kind of change.
- **ceph:** a backport's tracker ticket is of type Backport, copied from the
  ticket it backports. 15,116 of the 34,457 saved tickets are of that type,
  and each stands for its parent's type.
- **Where:** `data/kinds.yaml` (`Backport: parent`), `internal/tracker`.
- **Found:** the ticket types the tracker returned.

## Kind of change

### Where a pull request's kind comes from
- **Varies:** the sources that say whether a pull request is a bug fix, a
  feature, a cleanup or documentation, and their order.
- **ceph:** a backport takes the kind of the pull request it names. Otherwise,
  in order: the ticked boxes of the PR template's Tracker section ("Very
  recent bug", "New feature", "Doc update", "Code cleanup"; "References
  tracker ticket" names no kind); the type of the first tracker ticket it
  references that gives a kind; the kind labels `bug-fix`, `feature` and
  `cleanup`.
- **Where:** `internal/extract/hints.go` (the boxes, each known by the start
  of its label in the template), `internal/classify/kind.go`,
  `internal/tables/kinds.go`, `data/kinds.yaml`.
- **Found:** ceph/ceph's `.github/pull_request_template.md`.

### External issue tracker
- **Varies:** whether the project's issues live on GitHub or on another
  host, and so whether a second host is asked anything.
- **ceph:** issues are switched off on ceph/ceph; work is tracked on
  tracker.ceph.com, a Redmine. A pull request refers to a ticket by a
  `Fixes:` trailer in a commit message or by the ticket's address in its
  description. The tool asks the tracker only for each referenced ticket's
  type: anonymously, one request at a time, paced. The types seen are Bug,
  Backport, Feature, Enhancement, Documentation, Cleanup, Tasks, Subtask,
  Support, Motion, QA Run and Ceph Release.
- **Where:** `internal/tracker`, `internal/cli/tickets.go`,
  `internal/extract/hints.go` (`ticketURL`, `fixesTrailer`),
  `data/tickets.json`, `data/kinds.yaml` (`tracker`),
  `site/src/lib/table.ts` and `site/src/components/SelectedPr.svelte` (the
  links to a ticket).
- **Found:** the template's "References tracker ticket" box and the commit
  trailers.

### Closing issues
- **Varies:** whether GitHub's own "closes #N" references exist to read.
- **ceph:** none: the repository has no GitHub issues. Nothing reads them.
- **Where:** nowhere.
- **Found:** the repository's settings.

## AI disclosure

### Disclosure forms and trailer keys
- **Varies:** what the project asks for, and which trailer keys mean a
  disclosure.
- **ceph:** an `Assisted-by:` trailer is the commonest form, and pull
  requests in the data quote a documented format for it;
  `SubmittingPatches.rst` and the PR template do not mention it. The keys
  counted are `assisted-by`, `assistant-by`, `assited-by`,
  `ai-assisted-by`, `claude-session` and `generated-by`; a `Co-authored-by`
  trailer that gives a tool's own address also counts, and so do the
  phrases listed for descriptions and commit prose.
- **Where:** `data/tools.yaml` (`trailer_keys`, `phrases`),
  `internal/extract/disclosure.go`, `internal/classify/classify.go`,
  `site/src/content/methods/disclosure.md`.
- **Found:** `cephstats check --report`, which lists candidate lines that
  match nothing.

### Tool families
- **Varies:** which tools the project's contributors name, and the spellings
  that need a ruling.
- **ceph:** Copilot, Cursor, IBM Bob, Claude, OpenAI, Gemini, and
  "unspecified" for a disclosure that names none. A bare "Bob" in an
  `Assisted-by` trailer is IBM Bob.
- **Where:** `data/tools.yaml` (`families`), `site/src/lib/colours.ts`
  (`FAMILY_LINES`: a colour, marker and dash for each family id).
- **Found:** `cephstats check`, which fails on a counted disclosure that
  matches no family.

### Template and policy text that mentions AI
- **Varies:** text the project's own templates and rules put into many pull
  requests, which the disclosure word list would match.
- **ceph:** the PR template does not mention AI. Lines that quote or discuss
  the project's own rule about the trailer are listed as not disclosures,
  each matched exactly.
- **Where:** `data/tools.yaml` (`ignore`).
- **Found:** `cephstats check --report`.

### Trailers that name people
- **Varies:** which commit trailers a project uses that carry a person's
  name and address.
- **ceph:** the project requires `Signed-off-by:` on every commit. A line
  with that key, or with `Reviewed-by:`, `Tested-by:` or another key on the
  never-kept list, is never kept, and any candidate line that holds an
  address is withheld.
- **Where:** `internal/extract/disclosure.go` (`neverKept`, `withhold`).
- **Found:** reviewing what the published records could hold of a person.

## Automation

### Bot commands, and the rule on `@`
- **Varies:** how people trigger automation from a comment.
- **ceph:** phrases typed as a whole comment. To Jenkins: `jenkins test make
  check`, `jenkins test windows`, `jenkins test api`, `jenkins retest this
  please`, the older "retest this please" and "test this please", and "ok to
  test". To the release-engineering audit bot: `/audit retest`, `/audit
  override`. Also `/config check ok` and `unstale`. None holds an `@`, so
  the rule that keeps a comment's text only when it is one line of at most
  80 characters without an `@` loses no Ceph command.
- **Where:** `data/commands.yaml`, `internal/tables/commands.go`,
  `internal/extract/extract.go` (`commentText`).
- **Found:** `cephstats check --report`, which lists frequent short comments
  that match no command.

### Automation accounts GitHub types as users
- **Varies:** which accounts post automated comments without GitHub's bot
  type.
- **ceph:** `ceph-jenkins`, which also opens the release-version pull
  requests, and `loic-bot`, a make-check bot of 2014 and 2015.
- **Where:** `data/bots.yaml`.
- **Found:** `cephstats check --report`, which lists frequent commenters that
  look like bots.

### Labels
- **Varies:** which labels are components, which are process states, and
  who sets them.
- **ceph:** 31 components (RGW, CephFS, RBD, Core, Monitor, Manager,
  Dashboard, cephadm, …), most set by ceph/ceph's labeler from the paths a
  pull request touches, so one pull request often carries several. Process
  labels are `needs-*`, `need-*`, `wip-*`, `releng-audit-*`, `backport*` and
  `ui-tested-*`.
- **Where:** `data/labels.yaml`, `internal/tables/labels.go`.
- **Found:** `cephstats check`, which fails on a label carried by five or
  more pull requests that nothing classifies.

## Prose and tests

### Methods pages and README
- **Varies:** every sentence that describes the project's conventions.
- **Where:** `site/src/content/methods/*.md`, `README.md`. Figures are
  placeholders computed from the data; sentences are not.
- **Found:** reading them.

### Test data
- **Varies:** the examples the tests are built from.
- **ceph:** recorded responses and fixtures use Ceph's tracker addresses,
  backport descriptions and trailers, and one smoke check opens a day of
  Ceph's history by its date.
- **Where:** `internal/extract/testdata`, `site/src/lib/__fixtures__`,
  `site/e2e/smoke.spec.ts`.
- **Found:** searching the tree for the name.
