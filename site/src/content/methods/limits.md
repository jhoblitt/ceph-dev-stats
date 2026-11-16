# What the data cannot show

The window starts on {{windowStart}}. A pull request opened before then is counted only when it was still open on or after that day. Its record then holds its comments, reviews and lifecycle events from before that day too, but counts of events take only those inside the period. The records can also hold one that finished before then, as [What is counted](#counted) says, but no period starts before that day, so it is never counted. So the site can show the state of the project since {{windowStart}} and how that state has moved, and not how it worked before. The report opens on its default period, from {{periodStart}} to {{asOf}}, and shows another only when a reader chooses it.

## No comparison across years

This page draws no comparison between the years before LLM tools were common and the years since. Where the data reaches back that far, a reader can move the period and look. But years can differ in ways that have nothing to do with tools: in the project's size and who was active in it, in the bots and automation it ran, and in what GitHub itself recorded at the time (see [Older pull requests](#limits-older-pull-requests)). So a difference between years is not, on its own, an effect of a tool.

## Author standing

An author's standing is how many pull requests they had opened in ceph/ceph before the one counted. It is counted from a baseline, GitHub's own count of the author's pull requests opened before {{windowStart}}, plus the author's pull requests in the data opened since then and before this one. So it is unknown for a pull request opened before {{windowStart}}, and for an author with no baseline: accounts GitHub types as bots and deleted accounts get none. The standing filter's "unknown" band holds these.

On the data as of {{asOf}}, standing is unknown for {{standing.unknown}} of the {{prs.active}} pull requests open at some point in the default period: {{standing.unknownBeforeWindow}} opened before {{windowStart}}, and {{standing.unknownInWindow}} opened since then by an author with no baseline.

## Older pull requests

Some rules read things a pull request need not have: reviews with a verdict, draft events, the checklist of the pull-request template, tracker tickets, and trailers that disclose tool use. A pull request without them, as an older one can be, is counted by the same rules, which then give:

- **No draft events**, and not a draft now: it was opened ready for review, and its waiting clock starts at its opening ([Responses, reviews and the waiting clock](#responses)).
- **No reviews**: its first response is the first comment by another person that is not a bot command, and it has no approval, so once finished it counts as finished without one. A week in which no selected pull request had a review has no one giving reviews in the [review capacity chart](#review-capacity).
- **No ticked box, no tracker ticket of a type that gives a kind, and no kind label**: its kind is unknown, unless it is a backport whose original has a kind ([Target, component and kind](#kind)).
- **No disclosing trailer, co-author or phrase**: it is counted as not disclosed, which does not mean that no tool was used ([Disclosure of LLM use](#disclosure)).
- **An automated account** that GitHub does not type as a bot and that `data/bots.yaml` does not list counts as a person, and a bot command that `data/commands.yaml` does not list is an ordinary comment ([The hand-edited tables](#tables)).

## Small groups and recent weeks

A share or a median over a few pull requests can move a long way with one more, and filters combined can narrow a selection to a handful. The fewer pull requests behind a figure, the less it says.

The most recent weeks hold the youngest pull requests, most of them unfinished, so their times are often not yet known and will change as the data is refreshed. Every time is elapsed calendar time, weekends and holidays included, and says nothing about effort.
