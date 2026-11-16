# What is counted, and when

The data holds the pull requests of [ceph/ceph](https://github.com/ceph/ceph) that were open at some point in a window that starts on {{windowStart}} and runs to {{asOf}}, the day the last complete fetch from GitHub began. A pull request opened before the window is in it when it was still open in the window.

On the data as of {{asOf}}, {{prs.active}} pull requests, on every branch, were open at some point in the report's default period, {{periodStart}} to {{asOf}}: {{prs.openedInPeriod}} opened in it and {{prs.openedBeforePeriod}} before it.

## How the pull requests are found

Each fetch lists pull requests by the time GitHub last updated them: by default every one updated since a day before the previous fetch began, and then every one still open. The first fetch went back to the start of the window. A pull request open at any moment in the window is either still open, and so listed, or was closed during the window, which updates it. A record is kept from one fetch to the next, and replaced when its pull request is fetched again.

This relies on GitHub's last-updated time: that every kind of change to a pull request moves it has not been verified, and a full fetch back to the start of the window is the fallback. The data is refreshed by hand, not on a schedule, so it can be some weeks old; the date above says how old.

A pull request that finished before {{windowStart}} can be among the records too, when GitHub updated it after that day. No period on this site starts before {{windowStart}}, so none of them is counted.

## What a filter selects

- **Period**: every pull request open at some point in the period, that is, opened before the period ends and not finished before it starts. Counts by calendar week, such as merges, reviews, bot commands and the backlog, count what happened in each week of the period to those pull requests; over a period longer than 53 weeks they count by calendar month instead. Counts of pull requests opened, the outcome curves and the figures by week opened take only those opened in the window during the period.
- **Target**: `main`, or every other branch together as "backports and other branches", or all.
- **Component** and **kind**: see [Target, component and kind](#kind). A pull request with two components is in both.
- **Size**: lines added plus lines deleted.
- **Author standing**: see [What the window cannot show](#limits).
- **Disclosure**: "disclosed" is any of the forms in [Disclosure of LLM use](#disclosure).
- **Exclude drafts**: leaves out the pull requests that are drafts now, not those that were drafts once.
- **Reopened**: keeps the pull requests reopened at least once.
- **Author**: keeps the pull requests a login opened.
- **Reviewer**: keeps the pull requests a login reviewed or commented on during the period, other than their own: see [The People tables](#people-tables).
