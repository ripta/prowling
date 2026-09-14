# ADR-01: Anchor pull request timeline items to a revision chain

**Status:** accepted
**Date:** 2026-09-13

## Context

A pull request view that groups activity by "what the code looked like at the time" needs a notion of head-ref
revisions. Review comments, review summaries, and CI runs each target a specific version of the branch. Grouping them
under that version is the whole point of the layout.

GitHub's GraphQL API does not hand this over directly. Three findings constrain the design.

`PullRequestTimelineItems` carries `HeadRefForcePushedEvent` for force-pushes. It carries no event at all for an
ordinary push. Ordinary pushes surface only as runs of `PullRequestCommit` items.

`PullRequestCommit` has no timestamp field. Its position in the timeline is ordered by the commit's `committedDate`.
That is when the commit was written, not when it reached the branch.

`Commit.pushedDate` was deprecated and removed on 2023-07-01. There is no direct push timestamp on a commit.

Measured on `rust-lang/rust#137944`. A run of 27 `PullRequestCommit` items dated `2025-06-16T23:04` appears in the
timeline before a `HeadRefForcePushedEvent` at `2025-06-17T07:45`. That event reports `beforeCommit: a748639`, so those
27 commits were not on the branch yet. Their tip `a31e1f1` only became head at `2025-06-17T12:16:31`. Ordering by
timeline position misplaces them by 13 hours.

## Decision

Model the timeline as a chain of revisions. A revision is one state of the head ref.

Build the chain from `CheckSuite.push`. That field returns a `Push` object carrying `previousSha`, `nextSha`, and
`pusher`. `CheckSuite.createdAt` timestamps the push to within seconds. Several check suites share one push, so dedupe
on `push.id`.

Cross-check the chain against `HeadRefForcePushedEvent`, which supplies `beforeCommit`, `afterCommit`, and `createdAt`.
It also covers pushes that triggered no check suite.

Anchor each item by commit oid wherever one exists:

- Review comments by `PullRequestReviewComment.originalCommit.oid`.
- Review summaries by `PullRequestReview.commit.oid`.
- Check runs by the commit oid they ran against.

Issue comments carry no commit. Anchor them by timestamp against the revision that was head at that moment.

Commits dropped by a force-push are absent from `pullRequest.commits`. Reach them through the force-push event's
`beforeCommit` and a direct `repository.object(oid:)` lookup.

## Rationale

The push record is exact where timestamps are a guess. It also arrives cheaply. `CheckSuite.push` is one nested field
on a query the view already makes for check runs.

Measured on `cli/cli#14429`, which uses ordinary pushes only. The chain reconstructs completely:

```
000000… → 98cb293  12:17:36  williammartin
98cb293 → 26fc6d4  12:32:55  williammartin
26fc6d4 → dc6221e  13:03:55  williammartin
dc6221e → a9d9d84  15:45:30  williammartin
```

Measured on `cli/cli#14349`, which has one force-push. `push.previousSha` is `4e10fe3` and `push.nextSha` is
`091f872`. Both match that pull request's `HeadRefForcePushedEvent` exactly. `CheckSuite.createdAt` matches the event's
`createdAt` to the second. So one mechanism covers both kinds of push, and the two sources agree.

The chain carries `pusher` as a side benefit. Attributing a revision to a person costs nothing extra.

## Consequences

Positive. Anchoring is exact for every item that carries a commit, which is every item except issue comments.
Force-pushed history is reconstructed rather than inferred. Revision boundaries get real wall-clock times, which makes
the timestamp fallback for issue comments as accurate as it can be. The model is pure data, so it transfers unchanged
to the Chrome extension.

Negative. The chain depends on check suites existing. A pull request with no CI produces no push records at all. Fork
pull requests may keep head-commit check suites in the head repository, leaving nothing on the base repo. Measured on
`rust-lang/rust#137944`, where head commits returned zero check suites from the base repo. Force-push events still
bound revisions in that case, but ordinary pushes become invisible.

The fallback for a commit with neither a check suite nor a covering force-push event is not settled here. PRW-001
milestone 1 measures how often that happens and settles the ordering then.

## Alternatives Considered

Anchor by timestamp. Each item belongs to the most recent push before it, by wall clock. Roughly 50 lines and no extra
query cost. Rejected because the `rust-lang/rust#137944` measurement shows it misplacing 27 commits by 13 hours.

Anchor review comments by `originalCommit` and everything else by timestamp. Correct for review comments. Still wrong
for commits, and it leaves review summaries on the timestamp path even though `PullRequestReview.commit` exists.

Drop the grouping and render one chronological stream. Rejected because version-anchored grouping is the reason the
project exists.

## References

- PRW-001 (originating proposal), section "Anchoring items to pushes"
