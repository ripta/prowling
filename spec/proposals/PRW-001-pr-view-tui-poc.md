# PRW-001: PR view proof of concept as a terminal UI

**Status:** scheduled
**Created:** 2026-09-13
**Updated:** 2026-09-13

## Dependencies

None.

## Impacts

- Future extension proposals, not yet filed. They depend on the data layer, the classification rules, and the
  timeline model settled here. File them once the layout stabilizes. See the Decision Log.

## Summary

A read-only terminal UI that renders one github.com pull request. The screen has two regions. A state header shows
the current state of the PR. A timeline below it groups comments and CI runs under the revision they targeted.
Procedural
noise is folded away. CI results are shown inline. Unresolved review threads come first.

The proof of concept exists to settle the information architecture: which fields to show, how to group them, and what
counts as noise. That work happens faster in a terminal than in a Chrome extension. The extension comes later, in its
own proposals.

## Motivation

The GitHub "Conversation" tab mixes several kinds of content in one chronological stream:

- A PR description that is either very long or empty.
- Update events such as new commits and force-pushes.
- Human comments, which may be procedural (talking to a bot, pinging a user) or technical (discussing the change).
- Bot and CI comments, which may also be procedural (confirming a request) or technical (calling out a failure).
- CI status checks at the bottom, which need an extra click per check to reach steps or logs.

Two observations shape the design. Most comments are point-in-time. A review comment is about the code at a specific
version. A CI failure is also about a specific version. CI state, though, is stateful. The most useful view of CI is
the latest result per check. So neither pure chronological order nor pure grouping by kind fits. The view needs a
stateful summary on top and a version-anchored timeline below.

## Design Decisions (Settled)

### Scope

Single PR at a time. github.com only. Read-only in v1.

Light actions such as resolving a thread, reacting, or re-running a check are expected in a later iteration. The data
layer must not make choices that block them. In practice that means keeping GraphQL node IDs on every model object and
not flattening review threads into plain comments.

Rationale: read-only keeps the first iteration small. Node IDs are cheap to carry and are what mutations need.

### Language and runtime

TypeScript on Bun. Bun runs TypeScript directly, has a built-in test runner, and can bundle the extension later.

Rationale: the extension must be JavaScript. Writing the fetch, normalize, and classify layer in TypeScript means it
is written once. The shared layer must use only `fetch` and standard web APIs. Bun-specific and Node-specific APIs
stay in the CLI entry point.

The shared layer is its own workspace package with no Bun or Node type packages in its `tsconfig.json`. The boundary
is a type error, not a convention.

### TUI library

OpenTUI, with an explicit checkpoint. If OpenTUI becomes cumbersome for something Ink already solves, that is raised
clearly for review. The ruling on whether to ditch OpenTUI or stick with it is made explicitly at that point. No
silent swap.

Rationale: OpenTUI is worth evaluating for its rendering speed and richer layouts. Rendering is kept separate from the
data model so a swap stays contained. The checkpoint is validated under milestone 2.

The front end is `@opentui/react`. Ink is React-only, so a swap ports components rather than rewriting them.

### Layout gate

Once the state header and the revision-grouped timeline render against live pull requests, work pauses. The user
reviews the TUI hands-on against at least three pull requests of their choosing, including one with force-pushes.
Findings go in the Decision Log. Any settled decision the review contradicts is reopened there. Nothing beyond that
point begins until the gate is ruled.

Rationale: this proposal exists to settle the information architecture, and that can only be judged with real data
on screen. Gating before classification, CI detail, and perspective keeps those from being built on a grouping that
turns out to be wrong. Seeing some real data is enough. The gate does not wait for all of it.

The gate sits at the end of the phase that delivers the header and timeline. See the phase index.

### Authentication

GitHub: shell out to `gh auth token`. Fall back to the `GITHUB_TOKEN` environment variable.

Google Cloud: application default credentials, as set up by `gcloud auth application-default login`.

Rationale: zero setup on a machine that already has `gh` and `gcloud` logged in. Neither choice carries over to the
extension, which will need its own auth story.

### Data source

GraphQL is primary. One query fetches the PR, its timeline items, review threads with resolution state, commits, check
runs, and Actions step detail. REST fills the one gap that GraphQL cannot: Actions job logs.

The raw diff is out of scope for v1. `PullRequestReviewComment.diffHunk` supplies the context around each comment from
GraphQL, and nothing in this design renders a full file diff. Dropping it removes a REST dependency and its pagination
handling.

GraphQL covers more than first assumed. `CheckRun.steps` returns `CheckStep` with `number`, `name`, `status`,
`conclusion`, and `secondsToCompletion`. A GitHub `CheckRun` is itself the Actions job, so there is no separate jobs
level to fetch.

Rationale: thread resolution state is GraphQL-only. Actions logs are REST-only. GraphQL pulls the whole PR in one
request.

### GraphQL partial errors

A GraphQL response can carry HTTP 200, a populated `data` object, and an `errors` array at the same time. Individual
nodes come back `null` while the rest succeed. Checking `response.ok` and reading `data` renders a view with silent
holes.

Errors are classified. Authentication and SAML failures are fatal, and the tool prints the remedy: `gh auth refresh -h
github.com`, or the organization's SSO authorization URL. Every other partial error renders, with a visible marker
where the data is missing. The error list stays attached to the model so the renderer can place the marker.

Rationale: measured against a `reviewed-by:ripta` search, where one node returned `null` with
`extensions.saml_failure` while the others succeeded. A SAML failure is not a gap in the data. It is a token that
needs authorizing, and that has one specific fix worth naming. Treating it as a hole hides an actionable problem.

This carries to the extension unchanged. Fine-grained PATs and OAuth apps both need organization approval under SAML
enforcement, as noted in the extension research write-up.

### Timeline model

Two regions.

The state header shows current state: latest result per check, review decision, count of unresolved threads,
mergeability, and requested reviewers. What "latest" means per check is settled below under Meaning of "latest" for a
check.

The timeline groups items under revisions. A revision is one state of the head ref, produced by a push or a
force-push. Each revision holds the review comments and CI runs that targeted its head commit.

The newest revision starts expanded, as does any older revision holding an unresolved thread. Everything else starts
collapsed. Expansion is independent of perspective.

The perspective boundary is drawn as a divider in the timeline rather than by expanding revisions. The two mechanisms
answer different things. Expansion surfaces what still needs action. The divider says where you left off.

Rationale: matches the point-in-time versus stateful split described in the Motivation. How items attach to a revision
is settled below under Anchoring items to pushes.

### Anchoring items to pushes

Question as raised: issue comments and review summaries carry no commit. Force-pushes replace commits, so a review
comment's original commit may no longer be on the branch.

Decision: build a revision chain, then anchor by commit oid wherever one exists.

The chain comes from `CheckSuite.push`, which carries `previousSha`, `nextSha`, and `pusher`. `CheckSuite.createdAt`
timestamps it to within seconds of the push. `HeadRefForcePushedEvent` supplies `beforeCommit`, `afterCommit`, and
`createdAt` as a cross-check, and covers pushes that triggered no check suite. Several check suites share one push, so
dedupe on `push.id`.

Anchoring per item kind:

- Review comments anchor by `originalCommit.oid`. The `outdated` flag marks the ones whose commit has left the branch.
- Review summaries anchor by `PullRequestReview.commit.oid`. That field exists, contrary to the question as raised.
- Check runs anchor by the commit oid they ran against.
- Issue comments anchor by timestamp, against the revision that was head at that moment. They carry no commit, so this
  is the only signal available.

Commits dropped by a force-push are absent from `pullRequest.commits`. Reach them through
`HeadRefForcePushedEvent.beforeCommit` and a direct `repository.object(oid:)` lookup.

Rationale: timestamp anchoring is measurably wrong. `PullRequestCommit` timeline items are ordered by `committedDate`,
and `Commit.pushedDate` was removed in 2023. On `rust-lang/rust#137944` a run of 27 commits dated `2025-06-16T23:04`
precedes a force-push at `2025-06-17T07:45` in the timeline. Those commits only reached the branch at `12:16:31` the
next day. The push record is exact, and it costs one nested field on a query already being made.

Deferred: what to do with a commit that has neither a check suite nor a covering force-push event. A pull request with
no CI at all produces no push records. Milestone 1 measures how often this happens and settles the fallback ordering
then.

Whether issue comments render inline, in a separate discussion section, or in a parallel lane is a rendering choice. It
does not touch this data model. Settled under milestone 2.

### Classification

Heuristics, deterministic and unit-tested. Signals include:

- Author type: `Bot` versus `User`.
- Body is a slash-command such as `/retest` or `/approve`.
- Body is only mentions, or only a mention plus a short phrase.
- Known bot phrasing, such as command acknowledgements.
- Event type: review comment versus issue comment versus review summary.

Procedural items are folded into compact rows, never dropped. A count is shown. A toggle reveals them.

Rationale: deterministic rules are testable against captured fixtures. Folding instead of hiding limits the damage
from a wrong classification.

### CI providers

A provider layer with two implementations and one fallback:

- GitHub Actions: steps come from GraphQL with the main query. Only failing step log excerpts need the Actions REST
  API.
- Google Cloud Build: build steps and failing step log excerpts via the Cloud Build API.
- Generic: name, conclusion, summary text, and details link via the Checks API. Used for any provider without a
  dedicated implementation.

Other providers are an explicit future need. The layer must make adding one a local change.

Rationale: current projects use Actions and Cloud Build. Work projects use a mix of others.

### Depth of CI normalization

One common shape, and one renderer over it.

```
Check { name, status, conclusion, startedAt, completedAt, detailsUrl, provider, summaryText?, steps: Step[] }
Step  { number, name, status, conclusion, durationSeconds, logExcerpt? }
```

Actions maps `CheckRun` to `Check` and `CheckStep` to `Step`. Cloud Build maps `Build` to `Check` and `BuildStep` to
`Step`. The generic provider fills `summaryText`, leaves `steps` empty, and relies on `detailsUrl`.

Rationale: the structural mismatch that motivated a per-provider renderer does not exist. A GitHub `CheckRun` is the
Actions job, so Actions is check-then-steps. Cloud Build is build-then-steps. Those map one to one. A second renderer
would be ongoing cost separating two things that are the same shape.

The provider seam sits where the real difference is, which is log retrieval and parsing. Both providers return one log
blob per check rather than per step. Actions delimits steps with `##[group]` markers in the job log. Cloud Build
prefixes lines with `Step #N`. So `logExcerpt` lives on `Step`, produced by a provider-specific parse of a per-check
blob. Same shape out, different parse in.

### Record and replay of API responses

Recording happens at the HTTP transport level. A `--record <dir>` flag writes each raw response to disk, keyed by a
hash of method, URL, and request body. A `--replay <dir>` flag serves from those files and makes no network calls. One
mechanism covers GraphQL and REST.

The `Authorization` header is never written to a recording.

The recording directory is gitignored by default. Fixtures reach the test tree only by being copied there explicitly.
Recordings from private or work pull requests hold repository content, so committing them is a deliberate act.

Rationale: the rate limit is not the driver. A full fetch of `cli/cli#14354`, a pull request with 17 force-pushes,
costs 7 points of the 5000 per hour budget and returns 48.7 KB in 1.3 seconds. That allows roughly 700 fetches an
hour.

Fixtures are the driver. Milestone 3 commits to fixture-tested classification, and the Risks section leans on fixtures
from real pull requests to catch regressions. Transport-level capture is the only variant that exercises the
normalizer against real payloads. Replay also makes layout iteration instant and offline.

An ETag-keyed cache was considered and does not apply. The GraphQL endpoint returns no `ETag` header and does not
honor conditional requests. It would help only the REST calls for Actions logs and the diff.

The JSON dump of the normalized model from milestone 1 stays. It serves reading and diffing, which raw recordings do
not.

### Meaning of "latest" for a check

One row per check in the state header. Each row shows the latest known result. A check that did not run on the newest
revision is marked stale inline, naming the revision it did run on.

```
checks   ✓ lint          SUCCESS
         ✓ build         SUCCESS
         ● integration   IN_PROGRESS
         ⚠ e2e           FAILURE   26fc6d4, 2 back
         ○ deploy        SKIPPED
         ! codeql        REQUIRED, never run
```

Six cases are distinguished:

1. Completed on the newest revision. Show the conclusion.
2. `QUEUED`, `IN_PROGRESS`, `WAITING`, `PENDING`, or `REQUESTED` on the newest revision. Show pending.
3. Completed on an older revision only. Show that result, marked stale with its revision.
4. Never ran on any revision, and `isRequired` is true. Show it as required and missing.
5. Never ran on any revision, and `isRequired` is false. Omit the row.
6. Conclusion `SKIPPED` on the newest revision. Show skipped, which is not the same as not-run.

`CheckRun.isRequired(pullRequestNumber:)` supplies the required flag. It is what separates case 4 from case 5.

Rationale: the revision chain makes staleness exact rather than a guess, so it costs one short suffix to say. A second
column for the previous result would spend terminal width on something empty whenever CI is healthy. Omitting case 5
follows the same reasoning as folding procedural comments. A check that never ran and does not gate the merge is
noise.

### Perspective

Two emphases, reviewer and author, with a toggle. Authorship is auto-detected from the viewer login. Reviewer emphasis
leads with unresolved threads and what changed since the viewer's last review. Author emphasis leads with CI failures,
requested changes, and who still needs to review.

Rationale: one person fills both roles on different PRs. A single layout would compromise one of them.

### Markdown in the terminal

Timeline rows show `bodyText`. A detail pane renders `body` richly. The pane strips HTML comments before rendering.

Rationale: `bodyText` strips HTML comments already. Measured on `cli/cli#14354`, the entire pull request template
instruction block disappears. That is the same noise the project exists to remove, and it costs nothing. `bodyText`
does flatten headings, list markers, and code fences, which matters because people paste terminal output into
comments. Confining that loss to dense rows and recovering it in the pane fits the compact-versus-detail split the
layout already has.

The pane must strip HTML comments itself. `body` is raw markdown, so the template comments return otherwise, and the
expanded view ends up noisier than the row it came from.

Which renderer the pane uses is decided at the milestone 2 checkpoint. OpenTUI ships a `<markdown>` component, and it
is the component OpenTUI is weakest at. Its own flagship consumer reports raw `**bold**` and `##` printed literally on
`@opentui/core` 0.4.5, and a 0.1.79 to 0.1.88 regression that broke both `<markdown>` and the `<code
filetype="markdown">` fallback. Mapping a `marked` AST onto OpenTUI text nodes and `<code>` renderables is the
fallback. OpenTUI styles through `StyledText` and `TextChunk` rather than raw ANSI, so a `marked-terminal` style
renderer would need a VT emulation shim and is not a drop-in.

Putting the rich renderer on exactly one surface is what makes that checkpoint cheap to act on.

### Long and empty descriptions

The description region collapses to a fixed number of lines, starting at 8, with the count of remaining lines shown
alongside. Expanding swaps the region to a `<scrollbox>` capped near half the viewport height. An empty description
shows a dim placeholder so the region does not silently vanish.

The line count comes from splitting `bodyText`, which is free and exact. It counts source lines, not wrapped display
lines. OpenTUI's `<text>` documents `wrapMode` but no `maxLines`, and exposes no way to measure display lines at a
given width, so an exact on-screen count would mean reimplementing the wrap or reading `scrollHeight` back after a
layout pass.

Rationale: expanding inline is destructive. A 58-line description in a 40-row terminal pushes the state header and the
whole timeline off screen, which removes the reason the tool was opened. Capping the expanded region keeps both
visible. `<scrollbox>` renders its own scrollbar on overflow and exposes `scrollTop` and `scrollHeight`, so the
indicator costs nothing to build.

Showing only the first paragraph was rejected on measurement. `cli/cli#14354` opens with `Depends on #14320.`, a
reference line rather than a summary. Template-driven repositories do this routinely.

The starting line count of 8 is a layout knob, tuned against real pull requests during the milestone 2 review rather
than fixed here.

A scrollable region competes with the outer timeline for keyboard focus. That contention exists only while the
description is expanded, which is opt-in.

### Changed since last review

Two boundaries, one per perspective. They answer different questions, so they are not a fallback chain.

Reviewer emphasis uses `PullRequest.viewerLatestReview.commit.oid`. That is the exact commit the viewer reviewed, and
it maps straight onto the revision chain. It advances only when the viewer submits a review, never on reading.

`viewerLatestReview` is null when the viewer has never reviewed the pull request. There is then no boundary, and the
whole pull request counts as changed. It does not fall back to the local read marker. The reviewer question is about
what has been reviewed, and nothing has been.

Author emphasis uses a local last-seen oid, persisted per pull request under `$XDG_STATE_HOME`, falling back to
`~/.local/state`. It advances every time the viewer opens the pull request. An author has no review of their own, so
reading is the only event available.

Rationale: a reviewer asking what moved since they reviewed should not have that marker wiped by merely opening the
tool. Treating local state as a fallback for a missing review would do exactly that on any pull request the reviewer
has not yet reviewed. Splitting by perspective matches the split already settled under Perspective.

`PullRequestRevisionMarker` was considered and rejected. It carries `lastSeenCommit`, which looked like the right
signal, but returned empty on all nine pull requests tested, including ones the viewer had reviewed.

Local state does not carry to the Chrome extension, which will use its own storage. It sits behind a small interface
for that reason.

### Extension work is out of scope

Everything about the Chrome extension lives in separate proposals. That includes entry point, auth, packaging, and any
layout changes needed for HTML. The research write-up under `spec/research/extension.md` stays the reference until
those are filed.

Revisit hook: file the first extension proposal once milestone 5 is done and the layout has been reviewed against real
PRs. The decision to open the view per PR via an action button, rather than take over every PR URL, is already known
and should be recorded there.

## Design Decisions (Open)

None. Two questions are deferred with revisit hooks, both recorded above: the fallback for commits with no push record
under milestone 1, and issue-comment placement under milestone 2.

## Risks

- **OpenTUI is young and may not support a needed layout or input pattern** — likelihood: medium, impact: medium.
  Mitigation: rendering is isolated from the data model. The checkpoint under milestone 2 surfaces friction early. A
  swap to Ink stays contained to the rendering layer.
- **OpenTUI's markdown component is its weakest surface** — likelihood: medium, impact: low.
  Mitigation: rich rendering is confined to the detail pane, so a failure degrades one surface rather than the whole
  timeline. Mapping a `marked` AST onto text nodes and `<code>` renderables is the fallback. Reports against
  `@opentui/core` 0.4.5 and the 0.1.79 to 0.1.88 regression are the evidence.
- **Fork PRs may keep head-commit check suites in the head repository, leaving no push record on the base repo** —
  likelihood: medium, impact: medium. Mitigation: force-push events live on the base repo's pull request either way,
  so the force-push chain survives. Measured under milestone 1 on `rust-lang/rust#137944`: neither repository holds
  suites for its head commits, and the base repository resolves every dropped head by oid. See the Decision Log under
  2026-09-14 for what that measurement does and does not show.
- **A pull request with no CI produces no push records, so revision boundaries are unknown** — likelihood: low,
  impact: low. Mitigation: force-push events still bound revisions. A pull request with no CI also has no check output
  to group, so the timeline degrades to a flat list rather than breaking. Fallback ordering settled under milestone 1.
- **SAML-enforced organizations return partial data under a 200 response** — likelihood: medium, impact: medium.
  Mitigation: errors are classified, and a SAML failure is fatal with the authorization remedy printed rather than
  rendered as a hole. Measured against a live search where one node returned `null` with `extensions.saml_failure`.
- **Cloud Build logs need GCP permissions that may be missing on some projects** — likelihood: medium, impact: low.
  Mitigation: degrade to the generic Checks provider when the Cloud Build API returns a permission error.
- **Heuristics misclassify a technical comment as procedural** — likelihood: medium, impact: medium.
  Mitigation: procedural items are folded, never dropped. A count and a toggle keep them reachable. Fixtures from real
  PRs catch regressions.
- **Runtime-specific code leaks into the layer meant to be shared with the extension** — likelihood: low, impact:
  medium. Mitigation: the shared layer is a separate module that imports nothing from Bun or Node. Its tests run
  without a terminal.
- **Rate limit exhaustion during rapid iteration** — likelihood: low, impact: low.
  Accepted: measured at 7 points for a full fetch of `cli/cli#14354`, against a budget of 5000 per hour. That is
  roughly 700 fetches an hour. Replay removes even that.
- **A recorded fixture leaks private repository content into a commit** — likelihood: low, impact: medium.
  Mitigation: the recording directory is gitignored by default, so a fixture reaches the test tree only by an explicit
  copy. The `Authorization` header is never written to a recording.

## Milestones

| Milestone | Description |
|-----------|-------------|
| 1 | Fetch and normalize. GraphQL client, auth, partial-error classification, revision chain, threads, comments, and checks. Transport record and replay. JSON dump output. Settles the fallback for commits with no push record, and validates a fork PR. |
| 2 | TUI skeleton in OpenTUI. State header, revision-grouped timeline, collapsible groups, keyboard navigation. Settles issue-comment placement, the detail-pane markdown renderer, and the description collapse height. Layout gate. OpenTUI checkpoint. |
| 3 | Classification heuristics with fixture tests. Procedural items folded with count and toggle. |
| 4 | CI provider layer. Actions step logs. Cloud Build via application default credentials. Generic Checks fallback. |
| 5 | Perspective toggle. Reviewer and author emphasis with authorship auto-detect. |

## Decision Log

- 2026-09-13: Proposal covers the terminal proof of concept only. Extension work deferred to separate proposals, to
  be filed after milestone 5.
- 2026-09-13: OpenTUI chosen over Ink on the condition that friction is raised for explicit review rather than
  resolved by a silent swap.
- 2026-09-13: Cloud Build support goes through the Cloud Build API with application default credentials, not just the
  Checks API summary.
- 2026-09-13: Timeline items anchor to a revision chain built from `CheckSuite.push`, cross-checked against
  `HeadRefForcePushedEvent`. Timestamp anchoring rejected as measurably wrong. The fallback for commits with no push
  record is deferred to milestone 1.
- 2026-09-13: Record and replay happens at the HTTP transport level, driven by the need for normalizer fixtures rather
  than by the rate limit. A full fetch measured 7 points of 5000. An ETag cache was rejected because the GraphQL
  endpoint returns no `ETag`.
- 2026-09-13: CI normalizes to one common check-and-step shape with a single renderer. `CheckRun.steps` puts Actions
  step detail in GraphQL, so the two providers already share a shape. The provider seam narrows to log retrieval and
  parsing.
- 2026-09-13: The state header shows one row per check with staleness marked inline, rather than a second column for
  the previous result. `isRequired` separates a missing check that gates the merge from one that can be omitted.
- 2026-09-13: Reviewer emphasis bounds "what changed" by `viewerLatestReview.commit.oid`. Author emphasis bounds it by
  a local read marker. Not a fallback chain, because the two perspectives ask different questions.
  `PullRequestRevisionMarker` rejected as unpopulated in practice.
- 2026-09-13: GraphQL partial errors are classified. Auth and SAML failures are fatal with a printed remedy. Other
  partial errors render with a visible marker. Raised after measuring a SAML-blocked node arriving alongside HTTP 200.
- 2026-09-13: Timeline rows show `bodyText`, which strips HTML comments for free. A detail pane renders `body` richly
  and strips HTML comments itself. The pane renderer is chosen at the milestone 2 OpenTUI checkpoint.
- 2026-09-13: The description collapses to 8 lines with a remaining-line count, and expands into a capped
  `<scrollbox>` rather than inline. Inline expansion would push the state header and timeline off screen.
- 2026-09-13: A reviewer who has never reviewed the pull request gets no boundary, and the whole pull request counts
  as changed. No fallback to the local read marker.
- 2026-09-13: The newest revision and any revision holding an unresolved thread start expanded, independent of
  perspective. The perspective boundary is a divider, not an expansion rule.
- 2026-09-13: The raw diff is dropped from v1. `diffHunk` covers comment context, and nothing renders a full file
  diff.
- 2026-09-13: Accepted. All open questions settled, Risks section compliant, no high-likelihood/high-impact risk
  outstanding.
- 2026-09-13: Promoted to Phases 1 through 5, one phase per milestone. Phases 3, 4, and 5 are independent of each
  other. The shared layer becomes a separate workspace package with no Bun or Node types. The TUI front end is
  `@opentui/react`.
- 2026-09-13: Layout gate added at the end of the header-and-timeline phase. The detail pane becomes its own phase,
  and classification, CI, and perspective shift to Phases 4, 5, and 6. All are held until the gate is ruled.
- 2026-09-14: Settled the fallback for a commit with no push record and no covering force-push event. A surviving
  commit joins the revision of the first head at or after it on the branch, so a push of several commits is one
  revision. A head that only appears as another revision's predecessor becomes an inferred revision with no
  timestamp, ordered right before its successor. Issue comments anchor by time against revisions with a known time;
  the first revision owns everything earlier. Measured: none of the 7 surviving commits across the three `cli/cli`
  fixtures fall in this case. On the fork, 29 of 30 do, and they collapse into the head revision, which is the
  27-commit case ADR-01 describes.
- 2026-09-14: Measured the fork PR. `rust-lang/rust#137944` returns no check suites for any of its 30 head commits
  from the base repository. A probe of the head repository `davidtwco/rust` on the head, a dropped head, and a
  non-head commit found none there either. The pull request is fifteen months old, past Actions' default 90-day run
  retention, so this does not show where a fresh fork PR keeps its suites. The base repository resolves all 65 dropped
  heads by oid. The chain is bounded by the 63 force-push events, with 2 gaps where ordinary pushes on the fork left
  no trace. A head-repository lookup stays out of scope until a fresh fork PR shows suites there.
- 2026-09-14: Revisions are identified by index, since a force-push away and back gives one oid two revisions. The
  chain orders by `previousOid` links first and by time second. The earliest suite on a push lands within a second of
  the force-push event; the latest lags by up to 58 minutes. Where a dropped commit resolves with its suites, its push
  record turns the opening head from an inferred revision into a real push with a timestamp, measured on
  `cli/cli#14354` and `cli/cli#14349`.
- 2026-09-14: A push record's `previousSha` infers a revision only when it names a surviving commit. A branch created
  in the web UI records a base-branch commit there, and inferring or fetching it would leak base history into the
  chain.
- 2026-09-14: A server error is never written to a recording. A 502 recorded mid-fetch replayed on every later run.
- 2026-09-14: Phase 1 complete. The data layer fetches, normalizes, and anchors a pull request, and replays every
  fixture offline.
- 2026-09-14: A check is known only from a run that was seen, so never-run means a run that registered and never
  started, rather than a check the branch expects and never got. Nothing in the response lists the second kind. Case 4
  is a name whose every run has no start and no conclusion, and case 5 drops the same name when it does not gate the
  merge.
- 2026-09-14: Check rows sort by attention rather than by name, and the check block scrolls inside the header with a
  count of what it holds above it. Measured on `cli/cli#14429`, where 10 of 21 names report stale from bot workflows
  that run on `pull_request_target` and not on every push. Ordering by name puts the row that needs acting on below
  the fold.
- 2026-09-14: Collapsed description lines render one per row with wrapping off and a trailing ellipsis, rather than
  wrapped inside a clipped box. This keeps the source-line count and the rows on screen the same number. Input for the
  layout gate: `bodyText` lines are paragraphs, and the first line of `rust-lang/rust#137944` is 253 characters, so 8
  lines of source is a much taller block than 8 lines suggests.

## References

- ADR-01: why timeline items anchor to a revision chain built from push records rather than to timestamps.
- `spec/research/extension.md`: research on serving a custom page from a Manifest V3 extension and reaching the GitHub
  API from it.
