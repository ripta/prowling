# Phase 3: Detail pane

**Goal:** Add the detail pane with rendered markdown, and write up the OpenTUI checkpoint.
**Status:** PLANNED
**Complexity:** MEDIUM
**Dependencies:** Phase 2. Held until the layout gate at the end of Phase 2 is ruled.

## Scope

Implements: PRW-001 M2, the detail pane and OpenTUI checkpoint portion. The header and timeline are Phase 2.

## Problem Statement

Timeline rows show `bodyText`, which drops code fences and list markers. Anything longer than a row needs somewhere to
render in full. And by now OpenTUI has been pushed through two phases of real layout work, which is the evidence the
checkpoint needs.

## Design Decisions

### Pane renderer behind one component

**Decision:** The pane renders `body` through a single `markdown.tsx` component. Whether that component wraps
OpenTUI's `<markdown>` or maps a `marked` AST onto text nodes and `<code>` renderables is settled in this phase and
recorded in PRW-001.

**Rationale:** one component means one place to swap. PRW-001 put the rich renderer on exactly one surface for this
reason.

### Checkpoint is a write-up, not a milestone

**Decision:** Phase 3.1 ends with a written account of every point where OpenTUI resisted across Phases 2 and 3. The
ruling on whether to keep OpenTUI is made with the user and recorded in PRW-001's Decision Log.

**Rationale:** design rulings are not implementation milestones. The write-up is the deliverable the ruling needs.

## Milestones

| Milestone | Proposal | Description | Status |
|-----------|----------|-------------|--------|
| 3.1 | PRW-001 M2 | Detail pane with markdown rendering. Settles the pane renderer. OpenTUI checkpoint write-up | NOT STARTED |

Deferred questions from PRW-001 milestone 2 owned here:

- Phase 3.1 settles the detail pane's markdown renderer.
- Phase 3.1 produces the OpenTUI checkpoint write-up.

Both get recorded in PRW-001's Decision Log before the milestone is DONE.

## Implementation

### Files to Create

1. `packages/cli/src/tui/detail.tsx` - detail pane
2. `packages/cli/src/tui/markdown.tsx` - pane renderer behind one component

### Files to Modify

1. `packages/cli/src/tui/app.tsx` - pane region and focus
2. `packages/cli/src/tui/keys.ts` - open and close the pane
3. `packages/cli/src/tui/revision.tsx` - open an item into the pane

### Changes Required

1. Detail pane rendering `body` with HTML comments stripped.
2. Open from a timeline item, close back to the timeline.
3. Checkpoint write-up.

## Acceptance Criteria

### Phase 3.1

- [ ] A timeline item opens into the detail pane, and the pane closes back to the timeline
- [ ] Detail pane renders `body` with HTML comments stripped
- [ ] Fenced code blocks and lists keep their shape in the pane
- [ ] Pane renderer settled and recorded in PRW-001
- [ ] Checkpoint write-up lists every point of OpenTUI friction met in Phases 2 and 3, and the ruling is recorded in
      PRW-001
- [ ] Tracking updated: this document, `spec/phases/index.md`, PRW-001 Decision Log
