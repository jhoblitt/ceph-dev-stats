# What the window cannot show

The window starts on {{windowStart}}. A pull request opened before then is counted only when it was still open in the window, and then with its earlier history. The data also holds some that finished before the window, because GitHub updated them during it, but no period selects them, so none is counted. So the site shows the state of the project since the window started and how that state has moved, and not how it worked before.

## No baseline

There is no period in the data from before LLM tools were common to compare with. A change seen inside the window is a change since {{windowStart}}, not a change since before LLM use began, and a level that looks high or low has nothing earlier to be measured against.

## Author standing

An author's standing is how many pull requests they had opened in ceph/ceph before the one counted. It is counted from a baseline, GitHub's own count of the author's pull requests opened before the window started, plus the author's pull requests opened in the window before this one. So it is unknown for a pull request opened before the window, and for an author with no baseline: accounts GitHub types as bots and deleted accounts get none. The standing filter's "unknown" band holds these.

On the data as of {{asOf}}, standing is unknown for {{standing.unknown}} of the {{prs.active}} pull requests open at some point in the default period: {{standing.unknownBeforeWindow}} opened before {{windowStart}}, and {{standing.unknownInWindow}} opened since then by an author with no baseline.

## Small groups and recent weeks

A share or a median over a few pull requests can move a long way with one more, and filters combined can narrow a selection to a handful. The fewer pull requests behind a figure, the less it says.

The most recent weeks hold the youngest pull requests, most of them unfinished, so their times are often not yet known and will change as the data is refreshed. Every time is elapsed calendar time, weekends and holidays included, and says nothing about effort.
