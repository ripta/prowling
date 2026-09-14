# Phases

Each phase implements one proposal, or a portion of one. Each phase holds one or more milestones, numbered from `.1`
within the phase and written `Phase 1.2`. Update this file whenever a phase is created, a milestone completes, or a
phase status changes.

| Phase | Proposal | Description | Status | Progress |
|-------|----------|-------------|--------|----------|
| 1 | PRW-001 | Data layer: transport, model, revision chain | PLANNED | 0/3 |
| 2 | PRW-001 | TUI skeleton: header, timeline, detail pane | PLANNED | 0/3 |
| 3 | PRW-001 | Classification and folding | PLANNED | 0/2 |
| 4 | PRW-001 | CI providers: Actions logs, Cloud Build, generic | PLANNED | 0/2 |
| 5 | PRW-001 | Perspective: boundaries and emphasis | PLANNED | 0/2 |

## Scheduling Notes

Phases 3, 4, and 5 depend on Phases 1 and 2 only. They do not depend on each other and can run in any order.

PRW-001 becomes `implemented` when Phase 5 completes. Its revisit hook for the first extension proposal fires then.

## Pending Phases

- Phase 1: Data layer
- Phase 2: TUI skeleton
- Phase 3: Classification
- Phase 4: CI providers
- Phase 5: Perspective
