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

## License

[Apache-2.0](LICENSE)
