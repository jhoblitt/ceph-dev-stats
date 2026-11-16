# How to check a number

Every figure on the site is computed in your browser from per-pull-request data, so a number can be traced to the pull requests behind it, and each of those to its pages on GitHub.

## From a figure to the pull requests

The table of pull requests lists every pull request open at some point in the period under the current filters. Choosing a week of a chart, or a month over a long period, narrows it to the pull requests opened during the part of that week or month that lies inside both the window and the period, so a first week that starts earlier leaves out those opened before. Choosing an age band of the backlog narrows it to the pull requests behind that band. Each row's number links to the pull request on GitHub. Choosing a pull request, by its title in the table or by its dot, shows it above the table: a link to it on GitHub, its kind and what decided it, links to the tracker tickets it references, and, for a backport, a link to the pull request it backports.

## What the data keeps to link to

Each year's table file keeps what GitHub identifies each thing by, so that a link can be built from it and the pull request's number: one entry for each event, that is each comment, review and lifecycle event, and the SHA of each commit, with its times, where the data has one.

For each kind of event, the entry is:

- a comment, a bot command or a bot account's comment: the comment's id, its place in the pull request's conversation;
- a review of any kind: the review's id;
- marked ready, converted to a draft, and closed: the event's id in the conversation;
- merged: the merge commit's SHA;
- a force-push: the SHA of the commit it pushed;
- reopened: nothing. GitHub gives a reopening no address of its own; the pull request's page is the nearest.

GitHub records a merge as a merge and a close at nearly the same moment. A close at or within 5 seconds after a merge is that record of the merge and is not written to the site's data as an event of its own. When GitHub reports a pull request merged but recorded no merge event for it, its last close is written as its merge, with no commit to link to.

An event can also lack its address when GitHub returned none for it, or when its record was written before the data kept addresses. On the data as of {{asOf}}, {{refs.forcePushesWithoutCommit}} of the {{refs.forcePushes}} force-pushes in the window ({{refs.forcePushShareWithoutCommit}}) and {{refs.mergesWithoutCommit}} of the {{refs.merges}} merges in the window have no commit to link to.

{{table.eventRefs}}

## Rebuilding the data

The records the site's data is built from are public, under `data/` in [the site's repository](https://github.com/jhoblitt/ceph-dev-stats), and `cephstats rollup` rebuilds the site's data from them and the hand-edited tables without fetching anything.
