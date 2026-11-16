# ceph-dev-stats

[![ci](https://github.com/jhoblitt/ceph-dev-stats/actions/workflows/ci.yml/badge.svg)](https://github.com/jhoblitt/ceph-dev-stats/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jhoblitt/ceph-dev-stats/badge)](https://scorecard.dev/viewer/?uri=github.com/jhoblitt/ceph-dev-stats)

Interactive statistics on [ceph/ceph](https://github.com/ceph/ceph) pull
requests: how long a pull request waits for a human response, for approval
and for merge, how much of that is spent after the code stopped changing,
and whether disclosed LLM assistance is changing any of it. A Go tool,
`cephstats`, will fetch the pull requests and build the data; a static site
will render it and compute the statistics in the browser.

The design is
[`docs/superpowers/specs/2026-11-15-ceph-pr-stats-design.md`](docs/superpowers/specs/2026-11-15-ceph-pr-stats-design.md).

## Install

The `cephstats` tool builds from this checkout:

```sh
go build -o bin/cephstats ./cmd/cephstats
```

## Usage

`cephstats --help` lists the subcommands: `fetch`, `extract`, `check` and
`rollup`. None is implemented yet.

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
`node_modules` is missing or older than the lockfile. `cephstats rollup` is
not implemented yet, so `site-build` fails for now.

To work on the site without the Go side, `make site-dev-data` copies the
test fixture into `site/public/data/`; then run `npm run dev` in `site/` for
a live server, or `npm run build` and `npm run preview` to serve the built
site under its Pages base path, `/ceph-dev-stats/`. A build takes its
version from `APP_VERSION`; without it the footer reads `dev`.

## License

[Apache-2.0](LICENSE)
