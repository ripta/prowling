# Phases

Each phase implements one proposal, or a portion of one. Each phase holds one or more milestones, numbered from `.1`
within the phase and written `Phase 1.2`. Update this file whenever a phase is created, a milestone completes, or a
phase status changes.

| Phase | Proposal | Description | Status | Progress |
|-------|----------|-------------|--------|----------|
| 1 | PRW-001 | Data layer: transport, model, revision chain | COMPLETE | 3/3 |
| 2 | PRW-001 | Header and timeline, ending in the layout gate | COMPLETE | 2/2 |
| 3 | PRW-001 | Detail pane and OpenTUI checkpoint | COMPLETE | 2/2 |
| 4 | PRW-001 | Classification and folding | IN PROGRESS | 1/2 |
| 5 | PRW-001 | CI providers: Actions logs, Cloud Build, generic | PLANNED | 0/2 |
| 6 | PRW-001 | Perspective: boundaries and emphasis | PLANNED | 0/2 |

## Scheduling Notes

The layout gate sits at the end of Phase 2. The user reviews the header and timeline hands-on against live pull
requests before anything else is built on top of them. Phases 3 through 6 are held until the gate is ruled. The ruling
and any reopened decisions are recorded in PRW-001's Decision Log.

The gate was ruled on 2026-09-15. The grouping holds, and the collapsed description stays at 8 lines. Four findings
reopened settled decisions and are recorded in PRW-001's Decision Log: the description's source text, the check
block's share of the viewport, the timeline's checks entry against the header's, and the check sort order. All four
shipped as defect work against Phases 2 and 3 rather than as a phase of their own.

Phase 3's OpenTUI checkpoint was ruled the same day: keep OpenTUI.

Phase 3 reopened on 2026-09-16 with Phase 3.2, to fix a detail pane believed to draw only the fenced blocks of the
body it opens. Measurement found no defect. The pane fills 2ms after the key that opens it, and the blank rows were an
artifact of the harness that found them. 3.2 closed as the test that 3.1 should have had, plus a retraction in
PRW-001's Decision Log.

Phases 4, 5, and 6 depend on Phases 1 and 2 only. They do not depend on each other or on Phase 3, and can run in any
order now that the gate is ruled.

PRW-001 becomes `implemented` when Phase 6 completes. Its revisit hook for the first extension proposal fires then.

## Pending Phases

- Phase 5: CI providers
- Phase 6: Perspective
