# Phase 3: Classification

**Goal:** Separate procedural items from technical ones, and fold the procedural ones.
**Status:** PLANNED
**Complexity:** MEDIUM
**Dependencies:** Phase 1, Phase 2

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

## Milestones

| Milestone | Proposal | Description | Status |
|-----------|----------|-------------|--------|
| 3.1 | PRW-001 M3 | Heuristics in core with fixture tests | NOT STARTED |
| 3.2 | PRW-001 M3 | Folded rows with count and toggle in the TUI | NOT STARTED |

## Implementation

### Files to Create

1. `packages/core/src/classify.ts` - rules and the classifier
2. `packages/core/src/classify.test.ts` - per-rule tests and fixture sweeps
3. `packages/cli/src/tui/folded.tsx` - compact row with count and toggle

### Files to Modify

1. `packages/core/src/model.ts` - classification field on comments and reviews
2. `packages/core/src/normalize.ts` - call the classifier
3. `packages/cli/src/tui/revision.tsx` - fold procedural items

### Changes Required

1. Rules for author type, slash commands, mention-only bodies, known bot phrasing, and event type.
2. Classification stored on the model with the rule name.
3. Folded row per revision showing a count, expandable to reveal the items.

## Acceptance Criteria

### Phase 3.1

- [ ] Each signal listed in PRW-001 has a named rule and a test
- [ ] The model records the classification and the rule that fired
- [ ] A sweep over the Phase 1 fixtures asserts the expected classification for every comment, with the expected
      values checked in alongside the fixture
- [ ] Tracking updated: this document, `spec/phases/index.md`

### Phase 3.2

- [ ] Procedural items in a revision fold into one row showing a count
- [ ] The row expands to reveal every folded item, and no item is dropped
- [ ] Tracking updated: this document, `spec/phases/index.md`
