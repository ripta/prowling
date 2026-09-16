# Phase 4: Classification

**Goal:** Separate procedural items from technical ones, and fold the procedural ones.
**Status:** IN PROGRESS
**Complexity:** MEDIUM
**Dependencies:** Phase 1, Phase 2. Held until the layout gate at the end of Phase 2 is ruled.

## Scope

Implements: PRW-001 M3

## Problem Statement

Bot acknowledgements, slash commands, and bare pings outnumber technical comments on busy pull requests. The timeline
from Phase 2 shows all of them at equal weight.

## Design Decisions

### Classification runs at normalize time

**Decision:** Core classifies each comment and review during normalization and stores the result on the model, with
the name of the rule that fired.

**Rationale:** the JSON dump then shows the classification, and fixtures test it without a renderer. The renderer reads
a field instead of re-deriving one.

### Rules are data

**Decision:** Each signal from PRW-001 is one named rule. A rule returns a match or nothing. The first matching rule
wins, and its name is what the model records.

**Rationale:** a misclassification traces to one named rule. Adding a signal is adding a rule.

### A rule answers either way

**Decision:** a rule returns technical as readily as procedural. The event-type signal becomes two rules: an empty
review summary is procedural, and an inline review comment is technical.

**Rationale:** an inline comment is feedback on the code by construction. Saying so as a rule lets it short-circuit the
bot rules under it, which is what keeps a review bot's findings out of the fold.

### Rule order

**Decision:** `empty-body`, `slash-command`, `mention-only`, `review-comment`, `bot-phrasing`, `bot-author`.

**Rationale:** the body-shape rules run first, because a ping is a ping wherever it was posted, and a thread collects
as many of them as the conversation does. `review-comment` then sits above the two bot rules.
`copilot-pull-request-reviewer` opens every inline comment with an emoji, the same way the CI bots mark their status
lines, and those inline comments are the findings themselves.

### Known phrasing is a list, and it stops short of trouble

**Decision:** `bot-phrasing` carries the markers meaning accepted, running, or passed. The ones meaning failed or
conflicted are left off, so a body carrying them falls through to technical.

**Rationale:** PRW-001 counts a bot calling out a failure as technical, and folding one away is the error here that
costs something. An unrecognized marker stays visible for the same reason. Measured on `rust-lang/rust#137944`: 39 of
bors's 68 comments acknowledge a command or report a pass, and the other 29 are 5 test failures, 2 merge conflicts, and
22 notices that upstream made the branch unmergeable.

## Milestones

| Milestone | Proposal | Description | Status |
|-----------|----------|-------------|--------|
| 4.1 | PRW-001 M3 | Heuristics in core with fixture tests | DONE |
| 4.2 | PRW-001 M3 | Folded rows with count and toggle in the TUI | NOT STARTED |

## Implementation

### Files to Create

1. `packages/core/src/classify.ts` - rules and the classifier
2. `packages/core/src/classify.test.ts` - per-rule tests and fixture sweeps
3. `packages/cli/src/classify-fixtures.ts` - rewrites the expectations from replay
4. `packages/core/fixtures/pulls/<name>.classification.json` - the expectations, one file per fixture
5. `packages/cli/src/tui/folded.tsx` - compact row with count and toggle

### Files to Modify

1. `packages/core/src/model.ts` - classification field on comments and reviews
2. `packages/core/src/normalize.ts` - call the classifier
3. `packages/core/src/index.ts` - export the classifier
4. `packages/cli/src/tui/revision.tsx` - fold procedural items

### Changes Required

1. Rules for author type, slash commands, mention-only bodies, known bot phrasing, and event type.
2. Classification stored on the model with the rule name.
3. Expectations generated per fixture, beside its recording directory rather than inside it, since re-recording empties
   that directory.
4. Folded row per revision showing a count, expandable to reveal the items.

## Acceptance Criteria

### Phase 4.1

- [x] Each signal listed in PRW-001 has a named rule and a test
- [x] The model records the classification and the rule that fired
- [x] A sweep over the Phase 1 fixtures asserts the expected classification for every comment, with the expected
      values checked in alongside the fixture
- [x] Tracking updated: this document, `spec/phases/index.md`

### Phase 4.2

- [ ] Procedural items in a revision fold into one row showing a count
- [ ] The row expands to reveal every folded item, and no item is dropped
- [ ] Tracking updated: this document, `spec/phases/index.md`
