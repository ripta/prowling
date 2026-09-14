# PRW-001: PR view proof of concept as a terminal UI

**Status:** draft
**Created:** 2026-09-13
**Updated:** 2026-09-13

## Dependencies

None.

## Impacts

- Future extension proposals, not yet filed. They depend on the data layer, the classification rules, and the
  timeline model settled here. File them once the layout stabilizes. See the Decision Log.

## Summary

A read-only terminal UI that renders one github.com pull request. The screen has two regions. A state header shows
the current state of the PR. A timeline below it groups comments and CI runs under the push they targeted. Procedural
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

### TUI library

OpenTUI, with an explicit checkpoint. If OpenTUI becomes cumbersome for something Ink already solves, that is raised
clearly for review. The ruling on whether to ditch OpenTUI or stick with it is made explicitly at that point. No
silent swap.

Rationale: OpenTUI is worth evaluating for its rendering speed and richer layouts. Rendering is kept separate from the
data model so a swap stays contained. The checkpoint is validated under milestone 2.

### Authentication

GitHub: shell out to `gh auth token`. Fall back to the `GITHUB_TOKEN` environment variable.

Google Cloud: application default credentials, as set up by `gcloud auth application-default login`.

Rationale: zero setup on a machine that already has `gh` and `gcloud` logged in. Neither choice carries over to the
extension, which will need its own auth story.

### Data source

GraphQL is primary. One query fetches the PR, its timeline items, review threads with resolution state, commits, and
check runs. REST fills the gaps that GraphQL cannot: GitHub Actions jobs, steps, and logs, and the raw diff.

Rationale: thread resolution state is GraphQL-only. Actions logs are REST-only. GraphQL pulls the whole PR in one
request, which matters under the point-based rate limit.

### Timeline model

Two regions.

The state header shows current state: latest result per check, review decision, count of unresolved threads,
mergeability, and requested reviewers. "Latest" is the most recent run of each check, regardless of push.

The timeline groups items under pushes. A push is a head-ref update event, including force-pushes. Each push holds the
review comments and CI runs that targeted its head commit. The newest push is expanded. Older pushes are collapsed.

Rationale: matches the point-in-time versus stateful split described in the Motivation. Milestone 1 validates that the
GraphQL timeline carries enough to anchor items to pushes. Open questions below cover the cases that do not anchor
cleanly.

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

- GitHub Actions: jobs, steps, and failing step log excerpts via the Actions REST API.
- Google Cloud Build: build steps and failing step log excerpts via the Cloud Build API.
- Generic: name, conclusion, summary text, and details link via the Checks API. Used for any provider without a
  dedicated implementation.

Other providers are an explicit future need. The layer must make adding one a local change.

Rationale: current projects use Actions and Cloud Build. Work projects use a mix of others. How thin the common shape
can be is an open question.

### Perspective

Two emphases, reviewer and author, with a toggle. Authorship is auto-detected from the viewer login. Reviewer emphasis
leads with unresolved threads and what changed since the viewer's last review. Author emphasis leads with CI failures,
requested changes, and who still needs to review.

Rationale: one person fills both roles on different PRs. A single layout would compromise one of them.

### Extension work is out of scope

Everything about the Chrome extension lives in separate proposals. That includes entry point, auth, packaging, and any
layout changes needed for HTML. The research write-up under `spec/research/extension.md` stays the reference until
those are filed.

Revisit hook: file the first extension proposal once milestone 5 is done and the layout has been reviewed against real
PRs. The decision to open the view per PR via an action button, rather than take over every PR URL, is already known
and should be recorded there.

## Design Decisions (Open)

### Anchoring items that have no commit

Issue comments and review summaries carry no commit. Force-pushes replace commits, so a review comment's original
commit may no longer be on the branch.

Options:

1. Anchor by timestamp. An item belongs to the most recent push before it. Simple. Wrong when a review is submitted
   after a push but was written against the previous head.
2. Anchor review comments by `originalCommit` and issue comments by timestamp. Commits removed by a force-push map to
   the push that replaced them via the `beforeCommit` field on the force-push event.
3. Do not anchor issue comments at all. Show them in a separate discussion section under the state header.

Validated under milestone 1.

### Meaning of "latest" for a check that has not run on the newest push

A check may be pending, skipped, or simply not triggered on the newest push.

Options:

1. Show the most recent completed run and mark it stale with the push it ran on.
2. Show pending for the newest push, and the previous result in a secondary column.
3. Treat not-run as unknown and show nothing.

Validated under milestone 4.

### Depth of CI normalization

Options:

1. One common shape: check, jobs, steps, log excerpt. Both providers map into it. One renderer.
2. A common shape for check and conclusion only. Each provider has its own renderer for steps and logs.
3. Start with option 2. Promote to option 1 if the renderers converge.

Validated under milestone 4.

### Changed since last review

Options:

1. Derive from the viewer's latest review timestamp, available via GraphQL. No local state.
2. Persist a last-seen timestamp per PR under `$XDG_STATE_HOME`. Works for authors, who have no review of their own.
3. Both. Use the review timestamp when present and the local one otherwise.

Validated under milestone 5.

### Record and replay of API responses

Layout iteration re-fetches the same PR many times. The GraphQL rate limit is 5000 points per hour.

Options:

1. No caching. Accept the limit.
2. A `--record` flag that writes raw responses to JSON, and a `--replay` flag that reads them. The same files double
   as test fixtures.
3. An on-disk cache keyed by query and ETag, transparent to the user.

Validated under milestone 1. The JSON dump from that milestone is a natural starting point for option 2.

### Markdown in the terminal

GraphQL offers `body`, `bodyText`, and `bodyHTML`.

Options:

1. Render `body` with a terminal markdown renderer.
2. Show `bodyText`. No formatting, no dependency.
3. Show `bodyText` in the timeline and `body` in a detail pane.

Validated under milestone 2.

### Long and empty descriptions

Options:

1. Collapse the description after a fixed number of lines. Show a placeholder when empty.
2. Always collapse to one line with a toggle.
3. Show the first paragraph only.

Validated under milestone 2.

## Risks

- **OpenTUI is young and may not support a needed layout or input pattern** — likelihood: medium, impact: medium.
  Mitigation: rendering is isolated from the data model. The checkpoint under milestone 2 surfaces friction early. A
  swap to Ink stays contained to the rendering layer.
- **The GraphQL timeline may not carry enough to anchor items to pushes** — likelihood: medium, impact: high.
  Mitigation: milestone 1 tests anchoring against real PRs with force-pushes before any rendering is built. Timestamp
  anchoring is the fallback.
- **Cloud Build logs need GCP permissions that may be missing on some projects** — likelihood: medium, impact: low.
  Mitigation: degrade to the generic Checks provider when the Cloud Build API returns a permission error.
- **Heuristics misclassify a technical comment as procedural** — likelihood: medium, impact: medium.
  Mitigation: procedural items are folded, never dropped. A count and a toggle keep them reachable. Fixtures from real
  PRs catch regressions.
- **Runtime-specific code leaks into the layer meant to be shared with the extension** — likelihood: low, impact:
  medium. Mitigation: the shared layer is a separate module that imports nothing from Bun or Node. Its tests run
  without a terminal.
- **Rate limit exhaustion during rapid iteration** — likelihood: medium, impact: low.
  Accepted: a single PR costs well under 100 points. The record and replay question above removes the risk if it is
  settled in favor of recording.

## Milestones

| Milestone | Description |
|-----------|-------------|
| 1 | Fetch and normalize. GraphQL client, auth, PR model with pushes, threads, comments, and checks. JSON dump output. |
| 2 | TUI skeleton in OpenTUI. State header, push-grouped timeline, collapsible groups, keyboard navigation. OpenTUI checkpoint. |
| 3 | Classification heuristics with fixture tests. Procedural items folded with count and toggle. |
| 4 | CI provider layer. Actions jobs, steps, and logs. Cloud Build via application default credentials. Generic Checks fallback. |
| 5 | Perspective toggle. Reviewer and author emphasis with authorship auto-detect. |

## Decision Log

- 2026-09-13: Proposal covers the terminal proof of concept only. Extension work deferred to separate proposals, to
  be filed after milestone 5.
- 2026-09-13: OpenTUI chosen over Ink on the condition that friction is raised for explicit review rather than
  resolved by a silent swap.
- 2026-09-13: Cloud Build support goes through the Cloud Build API with application default credentials, not just the
  Checks API summary.

## References

- `spec/research/extension.md`: research on serving a custom page from a Manifest V3 extension and reaching the GitHub
  API from it.
