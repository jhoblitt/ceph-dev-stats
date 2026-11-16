# ceph-dev-stats

[![ci](https://github.com/jhoblitt/ceph-dev-stats/actions/workflows/ci.yml/badge.svg)](https://github.com/jhoblitt/ceph-dev-stats/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jhoblitt/ceph-dev-stats/badge)](https://scorecard.dev/viewer/?uri=github.com/jhoblitt/ceph-dev-stats)

Interactive statistics on [ceph/ceph](https://github.com/ceph/ceph) pull
requests: how long a pull request waits for a human response, for approval
and for merge, how much of that is spent after the code stopped changing,
and whether disclosed LLM assistance is changing any of it. A Go tool,
`cephstats`, fetches the pull requests and builds the data; a static site
renders it and computes the statistics in the browser.

The design is
[`docs/superpowers/specs/2026-11-15-ceph-pr-stats-design.md`](docs/superpowers/specs/2026-11-15-ceph-pr-stats-design.md).

## Install

The `cephstats` tool builds from this checkout:

```sh
go build -o bin/cephstats ./cmd/cephstats
```

## Usage

`cephstats --help` lists the subcommands; `cephstats <subcommand> --help`
lists each one's flags, every flag also settable as a `CEPHSTATS_`
environment variable.

- `fetch` walks ceph/ceph's pull requests from GitHub into the local raw
  cache, `.cache/`: every pull request updated since a day before the
  `fetched_through` time in `data/meta.json` (or since the window start,
  2026-05-15, when there is none), and every one still open. `--full` walks
  back to the window start. It reads the GitHub token from
  `CEPHSTATS_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`, in that order.
- `extract` turns the cached pull requests into the committed records under
  `data/`, rewriting only the files whose content changes. Every run
  re-derives each record from its cached entry in the current format.
- `tickets` asks tracker.ceph.com for the type of each tracker ticket the
  records reference that `data/tickets.json` does not hold yet. It asks
  anonymously, for up to 100 tickets a request and at most one request a
  second. `--refresh` asks again about the tickets the tracker would not
  show before.
- `check` validates the hand-edited tables against the records and fails,
  listing every problem, on a table that does not load, a `tools.yaml`
  with no `unspecified` family, a trailer or label no table accounts for,
  a counted disclosure that names no tool family, a ticket type
  `kinds.yaml` does not map, or record counts more than 0.5% from
  GitHub's. A candidate line can name a person, so the failure names a
  trailer or disclosure problem only by its trailer key, how many lines and
  which pull requests. `--report` also prints those lines, neighboring
  candidate lines that match a disclosure phrase only when joined, and
  what the tables do not match yet.
- `rollup` classifies the records in `data/` with the hand-edited tables
  and `data/tickets.json`, and writes the site's data files: `meta.json`,
  and `prs-<year>.json`, `events-<year>.json` and `table-<year>.json` for
  each year a pull request was opened in. They go to `site/public/data/`,
  or the directory `--out` names, and are not committed (see
  [Site](#site)). Only the files whose content changes are rewritten, and
  a year's files are removed once it has no records. It does not run
  `check`.

## Data

Everything under `data/` is committed and public. The site's data files
are derived from it by `cephstats rollup` and are not committed.

| File | What it holds | Written by |
|---|---|---|
| `prs/YYYY-MM.jsonl` | one record per pull request, in the file of the month it was opened: its times, state, size, labels, commits, lifecycle events, reviews and comments, and the lines that might disclose LLM use or say what kind of change it is | `extract` |
| `authors.json` | for each author, how many pull requests they opened before the window start | `extract` |
| `meta.json` | the window start, when the last walk began, and GitHub's counts from it | `extract` |
| `tickets.json` | the type of each tracker ticket a record references, and the ticket a Backport ticket was copied from | `tickets` |
| `tools.yaml` | what counts as a disclosure, and which tool it names | by hand |
| `bots.yaml` | accounts GitHub types as users whose comments are automated | by hand |
| `commands.yaml` | comments that only trigger automation | by hand |
| `labels.yaml` | which labels are components, process states, or neither | by hand |
| `kinds.yaml` | what makes a pull request a bug fix, a feature, a cleanup or documentation | by hand |

A record names people by login. It keeps a comment's text only when the
comment is one line of at most 80 characters with no `@`, which is what a
bot command looks like and what a mention or an e-mail address never is,
and it never keeps a commit trailer that names a person (`Signed-off-by:`,
`Reviewed-by:`, a `Co-authored-by:` naming a person, …). The lines it keeps
as possible disclosures are quoted as written. The raw GitHub responses
stay in `.cache/`, which git ignores.

The tables are applied when the data is read, so editing one never needs a
new pull.

## Updating

```sh
make data-refresh   # fetch, extract, tickets, check
```

`data-refresh` takes the token from the environment as `fetch` does; when
none of the three variables is set, it passes `gh auth token`'s token to
`fetch` alone.

If the closing `check` fails, the records hold something the tables do not
cover yet. Then:

1. `make data-report` runs `check --report`, which prints the candidate
   lines behind each trailer or disclosure problem the failure named, the
   lines an `ignore` entry is copied from; the neighboring description or
   commit-prose lines that match a disclosure phrase only when joined,
   which never count, so a real disclosure wrapped across two lines needs a
   phrase in `tools.yaml` that one of its lines matches alone; and then,
   most frequent first, the description and commit-prose lines that match
   no disclosure phrase,
   the short comments by people that match no command, the accounts with
   the most comments that GitHub does not type as bots, and the base
   branches. The reports quote lines and name people, so they are for
   whoever edits the tables, never for a CI log.
2. Edit the tables in `data/` until `make data-check` passes.
3. Commit `data/`.

When the cache format changes, the next `fetch` finds the entries in the
older format and walks back to the window start by itself to fetch them
again; the next `extract` then re-derives their records.

A refresh trusts GitHub's last-updated time: a pull request updated since
the last walk is fetched again, and one that is not is kept as cached.
Whether every kind of change to a pull request (a comment, a review, a push,
a label, a close) moves that time has not been verified yet. Until it is,
the fallback is

```sh
CEPHSTATS_FULL=true make data-refresh
```

which runs the whole refresh with `fetch` walking back to the window
start: `fetch` reads its `--full` flag from `CEPHSTATS_FULL`, and the other
steps have no such flag.

## Publishing

A merged refresh reaches the published site through a release. Each push to
`main` runs CI and then semantic-release, which cuts a version when a commit
since the last tag calls for one: a `feat`, `fix`, `perf`, `refactor`,
`docs` or `revert` commit, a `chore(data)` commit such as a data refresh, or
any commit marked breaking. The release tags the version and deploys the
site built from that tag to GitHub Pages, with the version in the footer.
Any other commit (`build`, `ci`, `test`, `style`, or another `chore`,
Dependabot's included) cuts no release unless marked breaking, and reaches
the site with the next release.

To roll the site back, run the `deploy` workflow by hand with an older
release tag, which must be on `main`:

```sh
gh workflow run deploy.yml -f tag=vX.Y.Z
```

The next release deploys its own version over it.

## Development

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/);
commitlint enforces this on every pull request. Every GitHub Action is pinned
to a commit SHA: run `pinact run` after editing a workflow and `actionlint`
before committing it. `make check` is the local gate, `make tools` installs
the pinned linter, and that pin lives in the `Makefile`.

## Site

The page is a Vite, Svelte and TypeScript site under `site/`, built with the
Node version in `.nvmrc`. It computes every figure in the browser from data
files it fetches at run time from `site/public/data/`, which
`cephstats rollup` writes from `data/` and git ignores.

```sh
make site-install   # npm ci --ignore-scripts
make site-build     # cephstats rollup, then vite build into site/dist
make site-test      # typecheck and unit tests
```

`site-build` and `site-test` install the dependencies first when
`node_modules` is missing or older than the lockfile. With no records under
`data/prs/`, `cephstats rollup` writes an empty dataset, so `site-build`
works on a fresh clone.

To work on the site without the Go side, `make site-dev-data` copies the
test fixture into `site/public/data/`; then run `npm run dev` in `site/` for
a live server, or `npm run build` and `npm run preview` to serve the built
site under its Pages base path, `/ceph-dev-stats/`. A build takes its
version from `APP_VERSION`; without it the footer reads `dev`.

## License

[Apache-2.0](LICENSE)
