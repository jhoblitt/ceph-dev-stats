# How to check a number

Every figure on the site is computed in your browser from per-pull-request data, so a number can be traced to the pull requests behind it, and each of those to its pages on GitHub.

## From a figure to the pull requests

The table of pull requests lists every pull request open at some point in the period under the current filters, the Author and Reviewer filters among them. Choosing a week of a chart, or a month over a long period, narrows it to the pull requests opened during the part of that week or month that lies inside both the window and the period, so a first week that starts earlier leaves out those opened before. Choosing an age band of the backlog narrows it to the pull requests behind that band. Each row's number links to the pull request on GitHub.

Choosing a pull request, by its title in the table or by its dot, shows a link to it on GitHub, its kind and what decided it, links to the tracker tickets it references, and, for a backport, a link to the pull request it backports. It also shows the pull request's timeline: its first commit, its opening, each comment, bot command and review, each lifecycle event, its last commit, and its final disposition or that it was still open at the last fetch, with the stretches it spent closed, the three spans, and the list of its commits.

## Where each mark links

The site stores no addresses. Each year's table file keeps what GitHub identifies each thing by: one entry for each event, that is each comment, review and lifecycle event, and the SHA of each commit, with its times, where the data has one. A mark's address is built from that and the pull request's number:

- a comment, a bot command or a bot account's comment: the comment, by its id, in the pull request's conversation;
- a review of any kind: the review, by its id;
- marked ready, converted to a draft, and closed: the event, by its id, in the conversation;
- merged and a force-push: the page of the commit it made, the merge commit or the commit pushed;
- the first and the last commit: that commit in the pull request's own view of its commits, or the whole of that view when none of the commits the data lists has that time; each commit in the list: that commit in the same view;
- opened, reopened, still open at the last fetch, and a final disposition GitHub recorded no event for: the pull request's page. GitHub gives a reopening no address of its own.

A mark whose address the data does not have is drawn without a link and says "address not recorded".

GitHub records a merge as a merge and a close at nearly the same moment. A close at or within 5 seconds after a merge is that record of the merge: the site's data leaves it out, and the timeline draws the merge alone. When GitHub reports a pull request merged but recorded no merge event for it, its last close is written as its merge, with no commit to link to.

An event can lack its address when GitHub returned none for it, or when its record was written before the data kept addresses. On the data as of {{asOf}}, {{refs.forcePushesWithoutCommit}} of the {{refs.forcePushes}} force-pushes in the window ({{refs.forcePushShareWithoutCommit}}) and {{refs.mergesWithoutCommit}} of the {{refs.merges}} merges in the window have no commit to link to.

{{table.eventRefs}}

## Rebuilding the data

The records the site's data is built from are public, under `data/` in [the site's repository](https://github.com/jhoblitt/ceph-dev-stats), and `cephstats rollup` rebuilds the site's data from them and the hand-edited tables without fetching anything.
