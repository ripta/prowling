# Phase 1: Data layer

**Goal:** Fetch one pull request and normalize it into a revision-anchored model, with no terminal involved.
**Status:** COMPLETE
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

**Decision:** Every connection in the query pages until exhausted. Cursors are followed inside core. A follow-up page
reaches its connection through `node(id:)` on the owning object, so it never refetches the rest of the pull request.

**Rationale:** the measured query used `first:100`. Long pull requests exceed that on commits and on timeline items.
A model built from the first page only is silently wrong.

### Steps are fetched after the main query

**Decision:** The main query stops at check runs. Steps come from a second document that takes up to 100 check run IDs
through `nodes(ids:)`. Only check runs under a GitHub Actions suite are asked for steps.

**Rationale:** GitHub scores a query by its `first` arguments, not by what comes back. Steps nested under commits,
suites, and runs would score around 250 points per fetch. The batched follow-up scores about 1 point per 100 runs.
Measured: the main query costs 6 points, the step batch 1, and each follow-up page 1. Only Actions produces steps.

### Dropped commits are looked up by oid after the main query

**Decision:** Every head a push record or force-push event names, minus the commits still on the branch, is fetched
through aliased `repository.object(oid:)` fields in batches of 25, with the oids as variables and sorted. Each resolved
commit drains its suites and runs like a surviving one, and its Actions runs get a step fetch of their own. One hop
only: push records found on the resolved commits add nothing further to fetch. `headRefOid` is never looked up. When
it is not the last commit on the branch, the commit list is stale, which a lookup would not fix.

**Rationale:** the existing documents stay untouched, so every recording made before this lookup existed remains
valid. Variables keep the document a function of batch size alone. A separate step fetch matters for the same reason:
appending the dropped runs to the surviving list would refill its last batch and change that request's replay key.

### Revisions are identified by index and ordered by chain links

**Decision:** an anchor names a revision by its index in `revisions`. Ordering follows `previousOid` links first, and
timestamps only to sort the segments those links form. A push record and a force-push event for the same head are
cross-checked on predecessor and on time, with 60 seconds of tolerance against the earliest suite on the push.

**Rationale:** a force-push away from a head and back gives one oid two revisions, which oid identity cannot express.
The push record is exact where the suite timestamp lags. Measured on `cli/cli#14354`: the earliest suite on a push
lands within a second of the force-push event, and the latest lags by 58 minutes.

### A push predecessor infers a revision only when it survives on the branch

**Decision:** a head that only appears as a predecessor becomes an inferred revision with no timestamp. For a
force-push event's `before` that is unconditional. For a push record's `previousSha` it holds only when the oid is a
surviving commit.

**Rationale:** a branch created in the web UI records a base-branch commit as the first push's predecessor. Inferring
a revision for it, and fetching it as a dropped commit, would leak base history into the chain.

### Fixtures are extended by filling misses

**Decision:** `record-fixtures.ts --fill` replays what is recorded and records only what is missing. A server error is
never written to a recording.

**Rationale:** a pull request keeps moving after it is recorded. Re-recording everything for one new request would
change what the existing recordings say. A 502 recorded mid-fetch replayed on every later run until it was deleted.

## Milestones

| Milestone | Proposal | Description | Status |
|-----------|----------|-------------|--------|
| 1.1 | PRW-001 M1 | Workspace, transport seam, auth, record and replay, partial-error classification | DONE |
| 1.2 | PRW-001 M1 | GraphQL query, normalized model with node IDs, JSON dump | DONE |
| 1.3 | PRW-001 M1 | Revision chain and anchoring. Settles the no-push-record fallback. Validates a fork PR | DONE |

Phase 1.3 owned two questions PRW-001 deferred to milestone 1: the fallback ordering for a commit with neither a check
suite nor a covering force-push event, and whether fork pull requests keep head-commit check suites off the base
repository. Both are settled in the proposal's Decision Log under 2026-09-14.

## Implementation

### Files to Create

1. `package.json` - workspace root, test and typecheck scripts
2. `packages/core/package.json` - shared layer, no runtime dependencies
3. `packages/core/tsconfig.json` - no Bun or Node types
4. `packages/core/src/transport.ts` - fetch seam, recorder interface, key hashing
5. `packages/core/src/github/errors.ts` - partial-error classification
6. `packages/core/src/github/graphql.ts` - request execution, HTTP errors, and classification of the response
7. `packages/core/src/github/ref.ts` - pull request reference parsing, URL and `owner/repo#N` forms
8. `packages/core/src/github/query.ts` - the GraphQL documents, raw types, and pagination
9. `packages/core/src/model.ts` - types with node IDs, Check and Step shape
10. `packages/core/src/normalize.ts` - raw response to model
11. `packages/core/src/pull-request.ts` - fetch and normalize in one call
12. `packages/core/src/revisions.ts` - chain construction and anchoring
13. `packages/core/fixtures/pulls/` - manifest and recordings for the fixture pull requests
14. `packages/cli/package.json` - depends on core and `bun-types`
15. `packages/cli/tsconfig.json`
16. `packages/cli/src/auth.ts` - `gh auth token` and `GITHUB_TOKEN`
17. `packages/cli/src/recorder.ts` - file-backed recorder
18. `packages/cli/src/main.ts` - entry point, `--record`, `--replay`, `--json`
19. `packages/cli/src/record-fixtures.ts` - re-records every fixture in the manifest
20. `.gitignore` - recordings directory

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
10. Fixtures recorded from four real pull requests: ordinary pushes only, two with force-pushes, and a fork.

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

- [x] One query fetches the pull request, timeline items, review threads with resolution state, commits with check
      suites and push records, check runs with steps and `isRequired`, and `viewerLatestReview`
- [x] Every connection pages until exhausted
- [x] Every model object carries its GraphQL node ID
- [x] Review threads stay threads, with `isResolved`, `isOutdated`, and their comments
- [x] Check runs normalize to the Check and Step shape, with Actions steps populated and generic providers carrying
      `summaryText`
- [x] `--json` prints the normalized model
- [x] Fixtures exist for four real pull requests (`cli/cli#14429`, `cli/cli#14354`, `cli/cli#14349`,
      `rust-lang/rust#137944`), and the normalizer's tests run against them
- [x] Tracking updated: this document, `spec/phases/index.md`

### Phase 1.3

- [x] Revision chain built from `CheckSuite.push`, deduplicated on `push.id`, timestamped by `CheckSuite.createdAt`
- [x] Chain cross-checked against `HeadRefForcePushedEvent`, with disagreement surfaced as a degradation
- [x] Review comments anchor by `originalCommit.oid`, reviews by `commit.oid`, check runs by their commit, issue
      comments by timestamp
- [x] Commits dropped by a force-push are resolved through `beforeCommit` and `repository.object(oid:)`
- [x] A fixture reproduces the `rust-lang/rust#137944` case, and a test proves the 27 commits anchor to the later
      revision
- [x] The fork PR fixture is measured, and the result is recorded in PRW-001's Decision Log
- [x] The fallback for a commit with no push record and no force-push event is settled and recorded in PRW-001
- [x] Tracking updated: this document, `spec/phases/index.md`, PRW-001 Decision Log
