# Phase 3: Detail pane

**Goal:** Add the detail pane with rendered markdown, and write up the OpenTUI checkpoint.
**Status:** COMPLETE
**Complexity:** MEDIUM
**Dependencies:** Phase 2. Held until the layout gate at the end of Phase 2 is ruled.

## Scope

Implements: PRW-001 M2, the detail pane and OpenTUI checkpoint portion. The header and timeline are Phase 2.

## Problem Statement

Timeline rows show `bodyText`, which drops code fences and list markers. Anything longer than a row needs somewhere to
render in full. And by now OpenTUI has been pushed through two phases of real layout work, which is the evidence the
checkpoint needs.

Phase 3.1 shipped the pane against a test that only ever asserted on two lines inside a fenced block. Those are the
only lines drawn on the frame the pane mounts on. The prose around them waits on the highlight, so the assertion was
passing against a pane the renderer had not filled. Phase 3.2 puts the prose under test and corrects the account of
why it was missing.

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
| 3.1 | PRW-001 M2 | Detail pane with markdown rendering. Settles the pane renderer. OpenTUI checkpoint write-up | DONE |
| 3.2 | PRW-001 M2 | Put the pane's prose under test, and retract the redraw diagnosis | DONE |

Deferred questions from PRW-001 milestone 2 owned here:

- Phase 3.1 settles the detail pane's markdown renderer.
- Phase 3.1 produces the OpenTUI checkpoint write-up.

Both get recorded in PRW-001's Decision Log before the milestone is DONE.

## Implementation

### Files to Create

1. `packages/cli/src/tui/detail.tsx` - detail pane
2. `packages/cli/src/tui/markdown.tsx` - pane renderer behind one component
3. `packages/core/src/view/markdown.ts` - HTML comment stripping

### Files to Modify

1. `packages/cli/src/tui/app.tsx` - pane region and focus
2. `packages/cli/src/tui/keys.ts` - open and close the pane
3. `packages/core/src/view/timeline.ts` - carry `body` on the entries that have one

### Changes Required

1. Detail pane rendering `body` with HTML comments stripped.
2. Open from a timeline item, close back to the timeline.
3. Checkpoint write-up.

`revision.tsx` needed no change. The cursor already resolves to a `TimelineEntry` through `flattenRows`, so the app
opens the pane without the row components knowing the pane exists.

`packages/core/src/view/timeline.ts` was not in the original list and had to be. The entry types carried `bodyText`
only, so the pane had nothing rich to render. `body` is fetched, normalized, and on the model already; the view layer
was dropping it.

## OpenTUI Checkpoint

The account the ruling needs. Phase 2's friction log is the record for that phase; this adds what Phase 3 met and
weighs the whole.

### What Phase 3 met

- `<markdown>` requires `syntaxStyle`, and it is not optional. Building one calls into the native render library, so
  it cannot be a module constant: at import time the renderer has not booted. It is built on first use instead.
- `mockInput.pressEscape()` delivers no escape that `useKeyboard` sees. The parser is not at fault, and
  `parseKeypress("\x1b")` returns `name: "escape"` as expected. This is the same shape as the Phase 2 note about
  `pressKey("tab")`, and worse: here the named helper exists and still does not arrive. The esc binding is covered in
  the key map's own test, which needs no renderer.

### What the proposal feared and what is actually true

PRW-001 rated the markdown component OpenTUI's weakest surface, on reports against `@opentui/core` 0.4.5 printing
raw `**bold**`, and a 0.1.79 to 0.1.88 regression. This project is pinned to 0.5.11, and that evidence no longer
describes it. `MarkdownRenderable` there parses with `marked`, highlights fences through tree-sitter, conceals
markers by default, and handles tables, blockquotes, and nested lists. Rendered against a real thread body from
`cli/cli#14354`, the fenced block keeps its shape and its contents.

So the fallback PRW-001 budgeted for, mapping a `marked` AST onto text nodes by hand, is not needed. It also stays
cheap to reach if that changes: `marked` is already in the tree as an OpenTUI dependency, and `renderNode` offers a
per-token override short of a full hand-rolled renderer.

### The weight of it

Across both phases the friction is consistent in kind. Nothing blocked a milestone. Every item cost a cycle to find,
because the failure arrived as wrong pixels rather than as an error: overflow drawn over neighbouring rows, a
truncation that cut from the middle, a row that compressed instead of clipping, a key helper that typed its own name.
The two Phase 3 items are both of that family.

Set against that, the layout work OpenTUI has actually carried is substantial: a scrolling header, a collapsing
description, a windowed timeline, and now a markdown pane, none of which needed a workaround that survived into the
code.

Recommendation: keep OpenTUI.

Ruled 2026-09-15: keep OpenTUI. Recorded in PRW-001's Decision Log.

## Acceptance Criteria

### Phase 3.1

- [x] A timeline item opens into the detail pane, and the pane closes back to the timeline
- [x] Detail pane renders `body` with HTML comments stripped
- [x] Fenced code blocks and lists keep their shape in the pane
- [x] Pane renderer settled and recorded in PRW-001
- [x] Checkpoint write-up lists every point of OpenTUI friction met in Phases 2 and 3, and the ruling is recorded in
      PRW-001
- [x] Tracking updated: this document, `spec/phases/index.md`, PRW-001 Decision Log

### Phase 3.2

- [x] A test asserts on the prose around a fenced block, so the path 3.1 missed is the path under test
- [x] The renderable's actual behaviour is measured, not inferred from a capture
- [x] Every comment and log entry stating the old diagnosis is corrected or retracted
- [x] Tracking updated: this document, `spec/phases/index.md`, PRW-001 Decision Log

Measured 2026-09-16: `CodeRenderable.startHighlight` requests the frame that fills the prose. Driving the app with no
forced render draws the whole body, 2ms after the key that opens the pane. There was no defect in the view. The
harness that found it captured the mounting frame and pumped nothing after it, which `renderUntilStable` later fixed.
