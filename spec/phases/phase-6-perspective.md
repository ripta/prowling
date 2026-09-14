# Phase 6: Perspective

**Goal:** Lead with what matters to the viewer's role, reviewer or author, with a toggle between them.
**Status:** PLANNED
**Complexity:** MEDIUM
**Dependencies:** Phase 1, Phase 2. Held until the layout gate at the end of Phase 2 is ruled.

## Scope

Implements: PRW-001 M5

## Problem Statement

One layout serves both roles poorly. A reviewer wants unresolved threads and what moved since they reviewed. An author
wants failures, requested changes, and who still owes a review.

## Design Decisions

### Read marker store

**Decision:** Core defines a store interface with `get(pr)` and `set(pr, oid)`. The CLI implements it as one JSON file
at `$XDG_STATE_HOME/prowling/seen.json`, falling back to `~/.local/state/prowling/seen.json`, keyed by
`owner/repo#number`.

**Rationale:** the filesystem is runtime-specific. The extension will implement the same interface over its own
storage.

### Boundary is computed once

**Decision:** Core computes the boundary revision for each perspective and attaches both to the model. Reviewer uses
`viewerLatestReview.commit.oid`, or no boundary when that is null. Author uses the read marker.

**Rationale:** the renderer draws a divider at a revision. It should not know where the revision came from.

### Marker advances after render

**Decision:** The author read marker is set to the head oid after the first successful render, not on fetch.

**Rationale:** a fetch that fails to render should not count as having seen the pull request.

## Milestones

| Milestone | Proposal | Description | Status |
|-----------|----------|-------------|--------|
| 6.1 | PRW-001 M5 | Authorship detection, both boundaries, read marker store, divider in the timeline | NOT STARTED |
| 6.2 | PRW-001 M5 | Reviewer and author emphasis layouts with a toggle | NOT STARTED |

## Implementation

### Files to Create

1. `packages/core/src/perspective.ts` - authorship, boundaries, store interface
2. `packages/cli/src/state.ts` - XDG-backed read marker store
3. `packages/cli/src/tui/divider.tsx` - the boundary line

### Files to Modify

1. `packages/core/src/model.ts` - perspective fields
2. `packages/cli/src/tui/header.tsx` - emphasis-specific ordering
3. `packages/cli/src/tui/timeline.tsx` - draw the divider
4. `packages/cli/src/tui/keys.ts` - the toggle

### Changes Required

1. Authorship from the viewer login against the pull request author.
2. Reviewer boundary from `viewerLatestReview`, author boundary from the store.
3. Divider drawn in the timeline at the active boundary.
4. Reviewer emphasis: unresolved threads first, then changes since the boundary.
5. Author emphasis: CI failures first, then requested changes, then who still needs to review.
6. Toggle between emphases, defaulting to the detected role.

## Acceptance Criteria

### Phase 6.1

- [ ] Authorship is detected from the viewer login
- [ ] Reviewer boundary comes from `viewerLatestReview.commit.oid`, and a null review yields no boundary with the whole
      pull request counted as changed
- [ ] Author boundary comes from the read marker, which advances to the head oid after a successful render
- [ ] The store writes under `$XDG_STATE_HOME`, falling back to `~/.local/state`
- [ ] The timeline draws a divider at the active boundary
- [ ] Tracking updated: this document, `spec/phases/index.md`

### Phase 6.2

- [ ] Reviewer emphasis leads with unresolved threads, then what changed since the boundary
- [ ] Author emphasis leads with CI failures, requested changes, and outstanding reviewers
- [ ] A key toggles between the two, defaulting to the detected role
- [ ] Tracking updated: this document, `spec/phases/index.md`, PRW-001 status to `implemented`,
      `spec/proposals/index.md`
