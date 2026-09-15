# Phases

Each phase implements one proposal, or a portion of one. Each phase holds one or more milestones, numbered from `.1`
within the phase and written `Phase 1.2`. Update this file whenever a phase is created, a milestone completes, or a
phase status changes.

| Phase | Proposal | Description | Status | Progress |
|-------|----------|-------------|--------|----------|
| 1 | PRW-001 | Data layer: transport, model, revision chain | IN PROGRESS | 2/3 |
| 2 | PRW-001 | Header and timeline, ending in the layout gate | PLANNED | 0/2 |
| 3 | PRW-001 | Detail pane and OpenTUI checkpoint | PLANNED | 0/1 |
| 4 | PRW-001 | Classification and folding | PLANNED | 0/2 |
| 5 | PRW-001 | CI providers: Actions logs, Cloud Build, generic | PLANNED | 0/2 |
| 6 | PRW-001 | Perspective: boundaries and emphasis | PLANNED | 0/2 |

## Scheduling Notes

The layout gate sits at the end of Phase 2. The user reviews the header and timeline hands-on against live pull
requests before anything else is built on top of them. Phases 3 through 6 are held until the gate is ruled. The ruling
and any reopened decisions are recorded in PRW-001's Decision Log.

Phases 4, 5, and 6 depend on Phases 1 and 2 only. They do not depend on each other or on Phase 3, and can run in any
order once the gate is ruled.

PRW-001 becomes `implemented` when Phase 6 completes. Its revisit hook for the first extension proposal fires then.

## Pending Phases

- Phase 2: Header and timeline
- Phase 3: Detail pane
- Phase 4: Classification
- Phase 5: CI providers
- Phase 6: Perspective
