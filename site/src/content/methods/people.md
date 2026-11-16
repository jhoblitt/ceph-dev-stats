# People and bots

A person is an account that GitHub does not type as a bot and that [`data/bots.yaml`](https://github.com/jhoblitt/ceph-dev-stats/blob/main/data/bots.yaml) does not list. This site identifies people by their GitHub login and by nothing else. It keeps no one's name, e-mail address or profile, though text a contributor wrote, such as a pull request's title, can name someone: see [What the data keeps about a person](#privacy).

## Bots

GitHub types some accounts as bots itself, such as the accounts of GitHub apps. Other accounts are automated but typed as people's accounts, such as `ceph-jenkins`, ceph/ceph's Jenkins; `data/bots.yaml` lists those, each with the reason, and matches a login in any case. A bot's comments and reviews are counted apart, as bot comments and bot reviews. They are never a response, a human review, or a reviewer's.

## The pull request's author

What the author of a pull request does on it is counted apart from what others do: a comment by the author is not a response, and a review by the author, such as a reply in a review thread, is not a review. Both are kept in the data as events of their own kind.

## Deleted accounts

GitHub gives no account for what a deleted account did and shows it as the placeholder user `ghost`; the data records it under that login. Every deleted account shares it, so a comment by a deleted account on a pull request opened by a deleted account counts as one by another person: the two are not known to be the same.
