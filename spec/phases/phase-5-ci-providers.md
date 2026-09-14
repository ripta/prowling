# Phase 5: CI providers

**Goal:** Show failing step log excerpts inline for Actions and Cloud Build, with a generic fallback for everything
else.
**Status:** PLANNED
**Complexity:** MEDIUM
**Dependencies:** Phase 1, Phase 2. Held until the layout gate at the end of Phase 2 is ruled.

## Scope

Implements: PRW-001 M4

## Problem Statement

Check rows show a conclusion and a link. Reaching the failing step and its log is still a click per check on
github.com, which is one of the costs PRW-001 sets out to remove.

## Design Decisions

### Provider seam

**Decision:** A provider has two functions. `logFor(check)` returns one log blob or nothing. `excerptFor(step, log)`
returns the lines belonging to that step. Providers are selected by `check.provider`, which the normalizer derives from
`CheckSuite.app.name` and the `detailsUrl` host.

**Rationale:** PRW-001 settled that both providers return one blob per check and differ only in how steps are
delimited. Two functions is the whole difference.

### Providers live in core, credentials come from the CLI

**Decision:** Provider implementations use `fetch` only and take a bearer token. The CLI supplies the Google token by
shelling out to `gcloud auth application-default print-access-token`.

**Rationale:** matches the `gh auth token` pattern already settled, and keeps `google-auth-library` out of the tree.
The Cloud Build REST API is plain HTTPS with a bearer token.

### Actions job identity

**Decision:** The Actions job id is `CheckRun.databaseId`. The log comes from
`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`, following the redirect.

**Rationale:** Actions jobs are check runs, so the ids coincide. Phase 5.1 verifies this against a fixture before
relying on it, and falls back to parsing `detailsUrl` if it does not hold.

### Cloud Build build identity

**Decision:** The build id and project come from the check's `detailsUrl`, which the Cloud Build GitHub app points at
the console page for the build. The exact URL shape is verified against a real check in Phase 5.2.

**Rationale:** the check run carries no other reference to the build.

### Logs fetch on demand

**Decision:** Logs are fetched when a check row is opened, not with the main query. Results go through the same
transport seam, so replay covers them.

**Rationale:** a pull request may have dozens of jobs. Fetching every log up front costs REST calls nobody asked for.

## Milestones

| Milestone | Proposal | Description | Status |
|-----------|----------|-------------|--------|
| 5.1 | PRW-001 M4 | Provider seam, generic provider, Actions logs with `##[group]` parsing, step and excerpt rendering | NOT STARTED |
| 5.2 | PRW-001 M4 | Cloud Build provider with `Step #N` parsing and permission-error degradation | NOT STARTED |

## Implementation

### Files to Create

1. `packages/core/src/ci/provider.ts` - the seam and provider selection
2. `packages/core/src/ci/generic.ts` - summary text and details link
3. `packages/core/src/ci/actions.ts` - job log fetch and `##[group]` parsing
4. `packages/core/src/ci/cloudbuild.ts` - build fetch, log fetch, `Step #N` parsing
5. `packages/cli/src/gcloud.ts` - application default credentials token
6. `packages/cli/src/tui/check.tsx` - steps and the failing excerpt

### Files to Modify

1. `packages/core/src/normalize.ts` - derive `check.provider`
2. `packages/cli/src/tui/header.tsx` - open a check row into its steps

### Changes Required

1. Provider seam and selection.
2. Generic provider.
3. Actions log retrieval and step delimiting.
4. Step list and failing excerpt rendering.
5. Cloud Build build and log retrieval, step delimiting, and degradation to generic on a permission or auth error.

## Acceptance Criteria

### Phase 5.1

- [ ] `check.provider` is derived during normalization and covered by fixture tests
- [ ] The generic provider renders `summaryText` and `detailsUrl` for a check with no steps
- [ ] Actions job id source verified against a fixture, and the result recorded in this document
- [ ] Actions job log fetched through the transport seam, so replay covers it
- [ ] `##[group]` parsing attributes lines to steps, tested against a recorded log
- [ ] Opening a failing check shows its steps and the failing step's excerpt inline
- [ ] Tracking updated: this document, `spec/phases/index.md`

### Phase 5.2

- [ ] Token comes from `gcloud auth application-default print-access-token`, with a clear error when unavailable
- [ ] Build id and project parsed from `detailsUrl`, with the URL shape recorded in this document
- [ ] Build steps map onto the Step shape
- [ ] `Step #N` parsing attributes lines to steps, tested against a recorded log
- [ ] A permission or auth error from the Cloud Build API degrades that check to the generic provider with a visible
      marker
- [ ] Tracking updated: this document, `spec/phases/index.md`
