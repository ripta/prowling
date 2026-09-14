# Phase 2: Header and timeline

**Goal:** Render the state header and the revision-grouped timeline in OpenTUI against live pull requests, then hold
for the layout gate.
**Status:** PLANNED
**Complexity:** HIGH
**Dependencies:** Phase 1

## Scope

Implements: PRW-001 M2, the header and timeline portion. The detail pane and the OpenTUI checkpoint are Phase 3.

## Problem Statement

The model exists but nothing shows it. The information architecture PRW-001 exists to settle can only be judged on
screen, against real pull requests. This phase puts enough on screen to judge it, and ends with that judgement.

## Design Decisions

### React reconciler

**Decision:** `@opentui/react`.

**Rationale:** Ink is React-only. If the checkpoint in Phase 3 rules against OpenTUI, components port rather than get
rewritten. That keeps the swap PRW-001 already budgets for as cheap as it can be.

### Rendering reads the model only

**Decision:** Components take the normalized model from core and nothing else. No component calls the transport.

**Rationale:** replay and fixtures already produce a model. Rendering from it keeps layout iteration offline, and keeps
an OpenTUI swap contained to `packages/cli/src/tui`.

### Layout gate

**Decision:** After Phase 2.2, work pauses. The user reviews the TUI hands-on against at least three live pull
requests of their choosing, including one with force-pushes. Findings go in PRW-001's Decision Log. Any settled
decision the review contradicts is reopened there. No later phase begins until the gate is ruled.

**Rationale:** classification, CI detail, and perspective all build on the grouping this phase renders. Judging the
grouping first keeps them from being built on something that turns out to be wrong. Seeing some real data is enough;
the gate does not wait for all of it.

## Milestones

| Milestone | Proposal | Description | Status |
|-----------|----------|-------------|--------|
| 2.1 | PRW-001 M2 | App shell, state header with check rows, description region with collapse and scrollbox | NOT STARTED |
| 2.2 | PRW-001 M2 | Revision-grouped timeline, expansion rules, keyboard navigation. Settles issue-comment placement. Layout gate | NOT STARTED |

Deferred questions from PRW-001 milestone 2 owned here:

- Phase 2.1 tunes the description collapse height, starting at 8 lines.
- Phase 2.2 settles where issue comments render: inline in the revision, in a separate discussion section, or in a
  parallel lane.

The detail pane's markdown renderer and the OpenTUI checkpoint are owned by Phase 3.

Each gets recorded in PRW-001's Decision Log before its milestone is DONE.

## Implementation

### Files to Create

1. `packages/cli/src/tui/app.tsx` - root layout, focus, key dispatch
2. `packages/cli/src/tui/header.tsx` - state header, check rows with staleness
3. `packages/cli/src/tui/description.tsx` - collapse, remaining count, scrollbox
4. `packages/cli/src/tui/timeline.tsx` - revision groups and expansion state
5. `packages/cli/src/tui/revision.tsx` - one revision and its items
6. `packages/cli/src/tui/keys.ts` - key bindings

### Files to Modify

1. `packages/cli/src/main.ts` - launch the TUI when `--json` is absent

### Changes Required

1. App shell with the two regions and a focus model.
2. State header: review decision, unresolved count, mergeability, requested reviewers, and one row per check following
   the six cases in PRW-001.
3. Description region: 8 lines collapsed with a remaining count, `<scrollbox>` capped near half the viewport when
   expanded, dim placeholder when empty.
4. Timeline grouped by revision, with the newest and any unresolved-thread revision expanded, others collapsed.
5. Keyboard navigation across revisions and items, expand and collapse.
6. Hands-on review against live pull requests, with findings recorded.

## Acceptance Criteria

### Phase 2.1

- [ ] The TUI launches against a replayed fixture with no network
- [ ] State header shows review decision, unresolved thread count, mergeability, and requested reviewers
- [ ] Check rows follow all six cases from PRW-001, including `REQUIRED, never run` and omission of non-required
      never-run checks
- [ ] Description collapses to N lines with the remaining count shown, N starting at 8
- [ ] Expanding swaps to a `<scrollbox>` capped near half the viewport, with the header and timeline still visible
- [ ] Empty description shows a dim placeholder
- [ ] Collapse height reviewed against real pull requests, and the chosen value recorded in PRW-001
- [ ] Tracking updated: this document, `spec/phases/index.md`, PRW-001 Decision Log

### Phase 2.2

- [ ] Timeline groups items under revisions from the chain
- [ ] The newest revision and any revision holding an unresolved thread start expanded, all others collapsed
- [ ] Review comments, reviews, and check runs render under the revision they anchor to
- [ ] Issue-comment placement settled and recorded in PRW-001
- [ ] Keyboard navigation moves between revisions and items and toggles expansion
- [ ] Layout gate: the TUI reviewed hands-on against at least three live pull requests, including one with
      force-pushes, with findings and any reopened decisions recorded in PRW-001's Decision Log
- [ ] Tracking updated: this document, `spec/phases/index.md`, PRW-001 Decision Log
