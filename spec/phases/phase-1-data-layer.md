# Phase 1: Data layer

**Goal:** Fetch one pull request and normalize it into a revision-anchored model, with no terminal involved.
**Status:** IN PROGRESS
**Complexity:** HIGH
**Dependencies:** None

## Scope

Implements: PRW-001 M1

## Problem Statement

Nothing exists yet. Every later phase needs a model of a pull request that already carries revisions, anchored items,
and CI checks with steps. Layout iteration needs that model replayable from disk without touching the network.

## Design Decisions

### Workspace layout

**Decision:** A Bun workspace with two packages. `packages/core` holds fetch, normalize, and classify. `packages/cli`
holds the Bun entry point, the TUI, and anything that touches the filesystem or a subprocess. Core's `tsconfig.json`
includes no Bun or Node type packages.

**Rationale:** the shared-layer boundary becomes a type error rather than a convention. That turns the leakage risk in
PRW-001 from a discipline problem into a build failure.

### Transport seam

**Decision:** Every GraphQL and REST request goes through one function in core with a `fetch`-shaped signature. Record
and replay wrap that one function. Core defines a recorder interface with `get` and `put`, keyed by a hash of method,
URL, and body. The CLI supplies a file-backed implementation.

**Rationale:** one seam means one place to record, one place to replay, and one place to strip the `Authorization`
header. Hashing uses `crypto.subtle`, which is a web standard, so core stays pure.

### Auth lives in the CLI

**Decision:** Core takes a token as a parameter. The CLI obtains it from `gh auth token`, falling back to
`GITHUB_TOKEN`.

**Rationale:** shelling out is a subprocess call, which is runtime-specific. Core never learns where the token came
from, which is also what the extension will need.

### Error classification lives in core

**Decision:** Core classifies GraphQL partial errors. Authentication and SAML failures raise a typed fatal error
carrying the remedy text. Other partial errors attach to the model as a list of degradations with the path they affect.

**Rationale:** the classification is a function of the response, not of the runtime. The CLI decides how to print the
remedy. A later renderer decides how to place a degradation marker.

### Pagination

**Decision:** Every connection in the query pages until exhausted. Cursors are followed inside core.

**Rationale:** the measured query used `first:100`. Long pull requests exceed that on commits and on timeline items.
A model built from the first page only is silently wrong.

## Milestones

| Milestone | Proposal | Description | Status |
|-----------|----------|-------------|--------|
| 1.1 | PRW-001 M1 | Workspace, transport seam, auth, record and replay, partial-error classification | DONE |
| 1.2 | PRW-001 M1 | GraphQL query, normalized model with node IDs, JSON dump | NOT STARTED |
| 1.3 | PRW-001 M1 | Revision chain and anchoring. Settles the no-push-record fallback. Validates a fork PR | NOT STARTED |

Phase 1.3 owns two questions PRW-001 deferred to milestone 1: the fallback ordering for a commit with neither a check
suite nor a covering force-push event, and whether fork pull requests keep head-commit check suites off the base
repository. Both get settled and recorded in the proposal's Decision Log before the milestone is DONE.

## Implementation

### Files to Create

1. `package.json` - workspace root, test and typecheck scripts
2. `packages/core/package.json` - shared layer, no runtime dependencies
3. `packages/core/tsconfig.json` - no Bun or Node types
4. `packages/core/src/transport.ts` - fetch seam, recorder interface, key hashing
5. `packages/core/src/github/errors.ts` - partial-error classification
6. `packages/core/src/github/query.ts` - the GraphQL document and pagination
7. `packages/core/src/model.ts` - types with node IDs, Check and Step shape
8. `packages/core/src/normalize.ts` - raw response to model
9. `packages/core/src/revisions.ts` - chain construction and anchoring
10. `packages/cli/package.json` - depends on core and `bun-types`
11. `packages/cli/tsconfig.json`
12. `packages/cli/src/auth.ts` - `gh auth token` and `GITHUB_TOKEN`
13. `packages/cli/src/recorder.ts` - file-backed recorder
14. `packages/cli/src/main.ts` - entry point, `--record`, `--replay`, `--json`
15. `.gitignore` - recordings directory

### Changes Required

1. Workspace and both packages typecheck independently.
2. Transport seam with record and replay.
3. Token acquisition in the CLI.
4. Partial-error classification with a fixture test per class.
5. The GraphQL query, covering timeline items, review threads, commits with check suites and push records, check runs
   with steps and `isRequired`, and `viewerLatestReview`.
6. Normalizer with node IDs preserved and review threads kept as threads.
7. JSON dump of the normalized model.
8. Revision chain from `CheckSuite.push`, cross-checked against `HeadRefForcePushedEvent`.
9. Anchoring per item kind, including the `repository.object(oid:)` lookup for dropped commits.
10. Fixtures recorded from three real pull requests: ordinary pushes only, force-pushes, and a fork.

## Acceptance Criteria

### Phase 1.1

- [x] `packages/core/tsconfig.json` lists no Bun or Node type packages, and typecheck passes for both packages
- [x] Every GraphQL and REST request passes through the one transport function
- [x] `--record <dir>` writes one file per response, keyed by hash of method, URL, and request body
- [x] `--replay <dir>` serves from disk and makes no network call, proven by a test with `fetch` stubbed to throw
- [x] A test asserts the `Authorization` header appears in no recording
- [x] The recordings directory is gitignored
- [x] Token comes from `gh auth token`, then `GITHUB_TOKEN`, with a clear error when neither is available
- [x] A fixture with `extensions.saml_failure` raises the fatal error with the remedy text
- [x] A fixture with a non-auth partial error yields a model carrying that degradation
- [x] Tracking updated: this document, `spec/phases/index.md`

### Phase 1.2

- [ ] One query fetches the pull request, timeline items, review threads with resolution state, commits with check
      suites and push records, check runs with steps and `isRequired`, and `viewerLatestReview`
- [ ] Every connection pages until exhausted
- [ ] Every model object carries its GraphQL node ID
- [ ] Review threads stay threads, with `isResolved`, `isOutdated`, and their comments
- [ ] Check runs normalize to the Check and Step shape, with Actions steps populated and generic providers carrying
      `summaryText`
- [ ] `--json` prints the normalized model
- [ ] Fixtures exist for three real pull requests, and the normalizer's tests run against them
- [ ] Tracking updated: this document, `spec/phases/index.md`

### Phase 1.3

- [ ] Revision chain built from `CheckSuite.push`, deduplicated on `push.id`, timestamped by `CheckSuite.createdAt`
- [ ] Chain cross-checked against `HeadRefForcePushedEvent`, with disagreement surfaced as a degradation
- [ ] Review comments anchor by `originalCommit.oid`, reviews by `commit.oid`, check runs by their commit, issue
      comments by timestamp
- [ ] Commits dropped by a force-push are resolved through `beforeCommit` and `repository.object(oid:)`
- [ ] A fixture reproduces the `rust-lang/rust#137944` case, and a test proves the 27 commits anchor to the later
      revision
- [ ] The fork PR fixture is measured, and the result is recorded in PRW-001's Decision Log
- [ ] The fallback for a commit with no push record and no force-push event is settled and recorded in PRW-001
- [ ] Tracking updated: this document, `spec/phases/index.md`, PRW-001 Decision Log
