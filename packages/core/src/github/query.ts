// The pull request query and its pagination. One document fetches the first page of everything.
// Follow-up documents page each connection through its owning node, so a follow-up never refetches
// the rest of the pull request.
//
// Steps are the exception. GitHub scores a query by its first arguments rather than by what comes
// back, and steps nested under commits, suites, and runs would score around 250 points per fetch.
// Fetching them afterwards with nodes(ids:) in batches of 100 check runs scores about 1 point per
// batch. Only Actions produces steps, so only Actions check runs are batched.
//
// The document text is part of the request body, and the body is part of the replay key. Editing
// any document, even its whitespace, invalidates every recorded fixture.

import type { Transport } from "../transport";
import type { Degradation } from "./errors";
import { graphql } from "./graphql";
import { formatPullRequestRef, type PullRequestRef } from "./ref";

export const TIMELINE_PAGE_SIZE = 100;
export const REVIEW_REQUEST_PAGE_SIZE = 20;
export const REVIEW_THREAD_PAGE_SIZE = 50;
export const THREAD_COMMENT_PAGE_SIZE = 50;
export const COMMIT_PAGE_SIZE = 50;
export const CHECK_SUITE_PAGE_SIZE = 10;
export const CHECK_RUN_PAGE_SIZE = 50;
export const STEP_PAGE_SIZE = 50;
export const STEP_BATCH_SIZE = 100;

export const ACTIONS_APP_SLUG = "github-actions";

const TIMELINE_ITEM_TYPES =
  "[PULL_REQUEST_COMMIT, PULL_REQUEST_REVIEW, ISSUE_COMMENT, HEAD_REF_FORCE_PUSHED_EVENT]";

// Raw types mirror the wire shape of the fragments below, field for field. The normalizer is the
// only other reader.

export type RawPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type RawPage<T> = {
  pageInfo: RawPageInfo;
  nodes: (T | null)[];
};

export type RawActor = {
  __typename: string;
  login: string;
};

export type RawOid = {
  oid: string;
};

export type RawReviewRequest = {
  id: string;
  requestedReviewer:
    | { __typename: "Team"; combinedSlug: string }
    | { __typename: "User" | "Bot" | "Mannequin"; login: string }
    | null;
};

export type RawTimelineItem =
  | {
      __typename: "PullRequestCommit";
      id: string;
      commit: RawOid;
    }
  | {
      __typename: "PullRequestReview";
      id: string;
      author: RawActor | null;
      state: string;
      body: string;
      bodyText: string;
      submittedAt: string | null;
      url: string;
      isMinimized: boolean;
      commit: RawOid | null;
    }
  | {
      __typename: "IssueComment";
      id: string;
      author: RawActor | null;
      body: string;
      bodyText: string;
      createdAt: string;
      url: string;
      isMinimized: boolean;
      minimizedReason: string | null;
    }
  | {
      __typename: "HeadRefForcePushedEvent";
      id: string;
      actor: RawActor | null;
      createdAt: string;
      beforeCommit: RawOid | null;
      afterCommit: RawOid | null;
    };

export type RawReviewComment = {
  id: string;
  author: RawActor | null;
  body: string;
  bodyText: string;
  createdAt: string;
  url: string;
  diffHunk: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  outdated: boolean;
  isMinimized: boolean;
  commit: RawOid | null;
  originalCommit: RawOid | null;
  pullRequestReview: { id: string } | null;
  replyTo: { id: string } | null;
};

export type RawReviewThread = {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: string;
  isResolved: boolean;
  isOutdated: boolean;
  isCollapsed: boolean;
  resolvedBy: RawActor | null;
  comments: RawPage<RawReviewComment>;
};

export type RawCheckRun = {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  url: string;
  summary: string | null;
  title: string | null;
  isRequired: boolean;
};

export type RawCheckSuite = {
  id: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  app: { slug: string; name: string } | null;
  push: {
    id: string;
    previousSha: string | null;
    nextSha: string | null;
    pusher: RawActor;
  } | null;
  workflowRun: {
    id: string;
    url: string;
    workflow: { name: string };
  } | null;
  checkRuns: RawPage<RawCheckRun> | null;
};

export type RawCommit = {
  id: string;
  oid: string;
  abbreviatedOid: string;
  messageHeadline: string;
  committedDate: string;
  authoredDate: string;
  author: { name: string | null; user: RawActor | null } | null;
  checkSuites: RawPage<RawCheckSuite> | null;
};

export type RawPullRequestCommit = {
  id: string;
  commit: RawCommit;
};

export type RawStep = {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  secondsToCompletion: number | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type RawPullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  body: string;
  bodyText: string;
  state: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergeable: string;
  reviewDecision: string | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  viewerDidAuthor: boolean;
  author: RawActor | null;
  headRepository: { nameWithOwner: string } | null;
  viewerLatestReview: {
    id: string;
    state: string;
    submittedAt: string | null;
    commit: RawOid | null;
  } | null;
  reviewRequests: RawPage<RawReviewRequest> | null;
  timelineItems: RawPage<RawTimelineItem>;
  reviewThreads: RawPage<RawReviewThread>;
  commits: RawPage<RawPullRequestCommit>;
};

type RawRoot = {
  viewer: { login: string };
  repository: { pullRequest: RawPullRequest | null } | null;
};

// Everything fetchPullRequestData returns. Every page inside pullRequest has been drained: nodes
// holds every node and hasNextPage is false. Steps sit apart, keyed by check run id, because the
// main query never asks for them.
export type PullRequestData = {
  viewer: { login: string };
  pullRequest: RawPullRequest;
  steps: Record<string, RawPage<RawStep>>;
};

export class PullRequestNotFoundError extends Error {
  constructor(ref: PullRequestRef, degradations: Degradation[]) {
    const reasons = degradations.map((degradation) => degradation.message);
    const detail = reasons.length === 0 ? "" : `: ${reasons.join("; ")}`;

    super(`pull request ${formatPullRequestRef(ref)} not found${detail}`);
    this.name = "PullRequestNotFoundError";
  }
}

// Fragments are shared between the main query and the follow-ups, so a field added in one place
// reaches every page. A document lists only the fragments it spreads, because GraphQL rejects a
// fragment that is defined and unused. compose walks the uses so each document gets exactly its
// transitive set.

type Fragment = {
  name: string;
  text: string;
  uses: Fragment[];
};

function fragment(name: string, on: string, body: string, uses: Fragment[] = []): Fragment {
  return { name, text: `fragment ${name} on ${on} {${body}}`, uses };
}

function compose(operation: string, uses: Fragment[]): string {
  const ordered = new Map<string, string>();

  const visit = (fragment: Fragment): void => {
    if (ordered.has(fragment.name)) {
      return;
    }

    for (const dependency of fragment.uses) {
      visit(dependency);
    }

    ordered.set(fragment.name, fragment.text);
  };

  uses.forEach(visit);

  return [operation.trim(), ...ordered.values()].join("\n\n");
}

const ActorFields = fragment("ActorFields", "Actor", " __typename login ");

const PageInfoFields = fragment("PageInfoFields", "PageInfo", " hasNextPage endCursor ");

const ReviewRequestFields = fragment(
  "ReviewRequestFields",
  "ReviewRequest",
  `
  id
  requestedReviewer {
    __typename
    ... on User { login }
    ... on Bot { login }
    ... on Mannequin { login }
    ... on Team { combinedSlug }
  }
`,
);

const ReviewRequestsPage = fragment(
  "ReviewRequestsPage",
  "ReviewRequestConnection",
  `
  pageInfo { ...PageInfoFields }
  nodes { ...ReviewRequestFields }
`,
  [PageInfoFields, ReviewRequestFields],
);

const TimelineItemFields = fragment(
  "TimelineItemFields",
  "PullRequestTimelineItems",
  `
  __typename
  ... on PullRequestCommit {
    id
    commit { oid }
  }
  ... on PullRequestReview {
    id
    author { ...ActorFields }
    state
    body
    bodyText
    submittedAt
    url
    isMinimized
    commit { oid }
  }
  ... on IssueComment {
    id
    author { ...ActorFields }
    body
    bodyText
    createdAt
    url
    isMinimized
    minimizedReason
  }
  ... on HeadRefForcePushedEvent {
    id
    actor { ...ActorFields }
    createdAt
    beforeCommit { oid }
    afterCommit { oid }
  }
`,
  [ActorFields],
);

const TimelineItemsPage = fragment(
  "TimelineItemsPage",
  "PullRequestTimelineItemsConnection",
  `
  pageInfo { ...PageInfoFields }
  nodes { ...TimelineItemFields }
`,
  [PageInfoFields, TimelineItemFields],
);

const ReviewCommentFields = fragment(
  "ReviewCommentFields",
  "PullRequestReviewComment",
  `
  id
  author { ...ActorFields }
  body
  bodyText
  createdAt
  url
  diffHunk
  path
  line
  originalLine
  outdated
  isMinimized
  commit { oid }
  originalCommit { oid }
  pullRequestReview { id }
  replyTo { id }
`,
  [ActorFields],
);

const ThreadCommentsPage = fragment(
  "ThreadCommentsPage",
  "PullRequestReviewCommentConnection",
  `
  pageInfo { ...PageInfoFields }
  nodes { ...ReviewCommentFields }
`,
  [PageInfoFields, ReviewCommentFields],
);

const ReviewThreadFields = fragment(
  "ReviewThreadFields",
  "PullRequestReviewThread",
  `
  id
  path
  line
  startLine
  originalLine
  originalStartLine
  diffSide
  isResolved
  isOutdated
  isCollapsed
  resolvedBy { ...ActorFields }
  comments(first: ${THREAD_COMMENT_PAGE_SIZE}) { ...ThreadCommentsPage }
`,
  [ActorFields, ThreadCommentsPage],
);

const ReviewThreadsPage = fragment(
  "ReviewThreadsPage",
  "PullRequestReviewThreadConnection",
  `
  pageInfo { ...PageInfoFields }
  nodes { ...ReviewThreadFields }
`,
  [PageInfoFields, ReviewThreadFields],
);

// isRequired needs the pull request number, so every document that reaches a check run declares
// $number.
const CheckRunFields = fragment(
  "CheckRunFields",
  "CheckRun",
  `
  id
  name
  status
  conclusion
  startedAt
  completedAt
  detailsUrl
  url
  summary
  title
  isRequired(pullRequestNumber: $number)
`,
);

const CheckRunsPage = fragment(
  "CheckRunsPage",
  "CheckRunConnection",
  `
  pageInfo { ...PageInfoFields }
  nodes { ...CheckRunFields }
`,
  [PageInfoFields, CheckRunFields],
);

const CheckSuiteFields = fragment(
  "CheckSuiteFields",
  "CheckSuite",
  `
  id
  status
  conclusion
  createdAt
  updatedAt
  url
  app { slug name }
  push {
    id
    previousSha
    nextSha
    pusher { ...ActorFields }
  }
  workflowRun {
    id
    url
    workflow { name }
  }
  checkRuns(first: ${CHECK_RUN_PAGE_SIZE}) { ...CheckRunsPage }
`,
  [ActorFields, CheckRunsPage],
);

const CheckSuitesPage = fragment(
  "CheckSuitesPage",
  "CheckSuiteConnection",
  `
  pageInfo { ...PageInfoFields }
  nodes { ...CheckSuiteFields }
`,
  [PageInfoFields, CheckSuiteFields],
);

const CommitFields = fragment(
  "CommitFields",
  "Commit",
  `
  id
  oid
  abbreviatedOid
  messageHeadline
  committedDate
  authoredDate
  author {
    name
    user { ...ActorFields }
  }
  checkSuites(first: ${CHECK_SUITE_PAGE_SIZE}) { ...CheckSuitesPage }
`,
  [ActorFields, CheckSuitesPage],
);

const CommitsPage = fragment(
  "CommitsPage",
  "PullRequestCommitConnection",
  `
  pageInfo { ...PageInfoFields }
  nodes {
    id
    commit { ...CommitFields }
  }
`,
  [PageInfoFields, CommitFields],
);

const StepFields = fragment(
  "StepFields",
  "CheckStep",
  " number name status conclusion secondsToCompletion startedAt completedAt ",
);

const StepsPage = fragment(
  "StepsPage",
  "CheckStepConnection",
  `
  pageInfo { ...PageInfoFields }
  nodes { ...StepFields }
`,
  [PageInfoFields, StepFields],
);

const PullRequestFields = fragment(
  "PullRequestFields",
  "PullRequest",
  `
  id
  number
  title
  url
  body
  bodyText
  state
  isDraft
  createdAt
  updatedAt
  closedAt
  mergedAt
  mergeable
  reviewDecision
  baseRefName
  headRefName
  headRefOid
  isCrossRepository
  viewerDidAuthor
  author { ...ActorFields }
  headRepository { nameWithOwner }
  viewerLatestReview {
    id
    state
    submittedAt
    commit { oid }
  }
  reviewRequests(first: ${REVIEW_REQUEST_PAGE_SIZE}) { ...ReviewRequestsPage }
  timelineItems(first: ${TIMELINE_PAGE_SIZE}, itemTypes: ${TIMELINE_ITEM_TYPES}) { ...TimelineItemsPage }
  reviewThreads(first: ${REVIEW_THREAD_PAGE_SIZE}) { ...ReviewThreadsPage }
  commits(first: ${COMMIT_PAGE_SIZE}) { ...CommitsPage }
`,
  [ActorFields, ReviewRequestsPage, TimelineItemsPage, ReviewThreadsPage, CommitsPage],
);

export const PULL_REQUEST_QUERY = compose(
  `
query PullRequest($owner: String!, $repo: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { ...PullRequestFields }
  }
}`,
  [PullRequestFields],
);

export const MORE_REVIEW_REQUESTS_QUERY = compose(
  `
query MoreReviewRequests($id: ID!, $cursor: String!) {
  node(id: $id) {
    ... on PullRequest {
      reviewRequests(first: ${REVIEW_REQUEST_PAGE_SIZE}, after: $cursor) { ...ReviewRequestsPage }
    }
  }
}`,
  [ReviewRequestsPage],
);

export const MORE_TIMELINE_ITEMS_QUERY = compose(
  `
query MoreTimelineItems($id: ID!, $cursor: String!) {
  node(id: $id) {
    ... on PullRequest {
      timelineItems(first: ${TIMELINE_PAGE_SIZE}, after: $cursor, itemTypes: ${TIMELINE_ITEM_TYPES}) { ...TimelineItemsPage }
    }
  }
}`,
  [TimelineItemsPage],
);

export const MORE_REVIEW_THREADS_QUERY = compose(
  `
query MoreReviewThreads($id: ID!, $cursor: String!) {
  node(id: $id) {
    ... on PullRequest {
      reviewThreads(first: ${REVIEW_THREAD_PAGE_SIZE}, after: $cursor) { ...ReviewThreadsPage }
    }
  }
}`,
  [ReviewThreadsPage],
);

export const MORE_THREAD_COMMENTS_QUERY = compose(
  `
query MoreThreadComments($id: ID!, $cursor: String!) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: ${THREAD_COMMENT_PAGE_SIZE}, after: $cursor) { ...ThreadCommentsPage }
    }
  }
}`,
  [ThreadCommentsPage],
);

export const MORE_COMMITS_QUERY = compose(
  `
query MoreCommits($id: ID!, $cursor: String!, $number: Int!) {
  node(id: $id) {
    ... on PullRequest {
      commits(first: ${COMMIT_PAGE_SIZE}, after: $cursor) { ...CommitsPage }
    }
  }
}`,
  [CommitsPage],
);

export const MORE_CHECK_SUITES_QUERY = compose(
  `
query MoreCheckSuites($id: ID!, $cursor: String!, $number: Int!) {
  node(id: $id) {
    ... on Commit {
      checkSuites(first: ${CHECK_SUITE_PAGE_SIZE}, after: $cursor) { ...CheckSuitesPage }
    }
  }
}`,
  [CheckSuitesPage],
);

export const MORE_CHECK_RUNS_QUERY = compose(
  `
query MoreCheckRuns($id: ID!, $cursor: String!, $number: Int!) {
  node(id: $id) {
    ... on CheckSuite {
      checkRuns(first: ${CHECK_RUN_PAGE_SIZE}, after: $cursor) { ...CheckRunsPage }
    }
  }
}`,
  [CheckRunsPage],
);

export const CHECK_RUN_STEPS_QUERY = compose(
  `
query CheckRunSteps($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on CheckRun {
      id
      steps(first: ${STEP_PAGE_SIZE}) { ...StepsPage }
    }
  }
}`,
  [StepsPage],
);

export const MORE_CHECK_RUN_STEPS_QUERY = compose(
  `
query MoreCheckRunSteps($id: ID!, $cursor: String!) {
  node(id: $id) {
    ... on CheckRun {
      steps(first: ${STEP_PAGE_SIZE}, after: $cursor) { ...StepsPage }
    }
  }
}`,
  [StepsPage],
);

// A connection's nodes list can hold null where a node was inaccessible. The error for it is
// already a degradation, so readers skip the hole.
export function present<T>(nodes: (T | null)[]): T[] {
  return nodes.filter((node): node is T => node !== null);
}

type Run = <T>(document: string, variables: Record<string, unknown>) => Promise<T>;

export async function fetchPullRequestData(
  transport: Transport,
  ref: PullRequestRef,
): Promise<{ data: PullRequestData; degradations: Degradation[] }> {
  const degradations: Degradation[] = [];

  // Degradations from follow-up pages keep the path of their own document, which starts at node
  // rather than at repository.pullRequest. Mapping them onto the model is left to the renderer.
  const run: Run = async (document, variables) => {
    const result = await graphql<never>(transport, document, variables);
    degradations.push(...result.degradations);
    return result.data;
  };

  const root = await run<RawRoot>(PULL_REQUEST_QUERY, {
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
  });

  const pullRequest = root.repository?.pullRequest ?? null;
  if (pullRequest === null) {
    throw new PullRequestNotFoundError(ref, degradations);
  }

  const { id, number } = pullRequest;

  if (pullRequest.reviewRequests !== null) {
    await drain(pullRequest.reviewRequests, (cursor) =>
      nodePage(run, MORE_REVIEW_REQUESTS_QUERY, { id, cursor }, (node: RawPullRequest) => node.reviewRequests),
    );
  }

  await drain(pullRequest.timelineItems, (cursor) =>
    nodePage(run, MORE_TIMELINE_ITEMS_QUERY, { id, cursor }, (node: RawPullRequest) => node.timelineItems),
  );

  await drain(pullRequest.reviewThreads, (cursor) =>
    nodePage(run, MORE_REVIEW_THREADS_QUERY, { id, cursor }, (node: RawPullRequest) => node.reviewThreads),
  );

  for (const thread of present(pullRequest.reviewThreads.nodes)) {
    await drain(thread.comments, (cursor) =>
      nodePage(run, MORE_THREAD_COMMENTS_QUERY, { id: thread.id, cursor }, (node: RawReviewThread) => node.comments),
    );
  }

  await drain(pullRequest.commits, (cursor) =>
    nodePage(run, MORE_COMMITS_QUERY, { id, cursor, number }, (node: RawPullRequest) => node.commits),
  );

  for (const { commit } of present(pullRequest.commits.nodes)) {
    if (commit.checkSuites === null) {
      continue;
    }

    await drain(commit.checkSuites, (cursor) =>
      nodePage(run, MORE_CHECK_SUITES_QUERY, { id: commit.id, cursor, number }, (node: RawCommit) => node.checkSuites),
    );

    for (const suite of present(commit.checkSuites.nodes)) {
      if (suite.checkRuns === null) {
        continue;
      }

      await drain(suite.checkRuns, (cursor) =>
        nodePage(run, MORE_CHECK_RUNS_QUERY, { id: suite.id, cursor, number }, (node: RawCheckSuite) => node.checkRuns),
      );
    }
  }

  const steps = await fetchSteps(run, actionsCheckRunIds(pullRequest));

  return { data: { viewer: root.viewer, pullRequest, steps }, degradations };
}

// drain fills a page in place. After it returns, nodes holds every node across all pages and
// pageInfo reports no next page. The raw types keep their wire shape, and the normalizer reads
// nodes without knowing pages existed.
async function drain<T>(page: RawPage<T>, next: (cursor: string) => Promise<RawPage<T>>): Promise<void> {
  while (page.pageInfo.hasNextPage) {
    const cursor = page.pageInfo.endCursor;
    if (cursor === null) {
      throw new Error("connection reports a next page without an end cursor");
    }

    const more = await next(cursor);
    page.nodes.push(...more.nodes);
    page.pageInfo = more.pageInfo;
  }
}

// A follow-up page reaches its connection through node(id:). A null node means the object vanished
// between requests, which is not a partial result the model can carry, so it stops the fetch.
async function nodePage<N, T>(
  run: Run,
  document: string,
  variables: { id: string; cursor: string; number?: number },
  pick: (node: N) => RawPage<T> | null,
): Promise<RawPage<T>> {
  const data = await run<{ node: N | null }>(document, variables);
  if (data.node === null) {
    throw new Error(`node ${variables.id} returned null while paging ${document.split("\n", 1)[0]}`);
  }

  return pick(data.node) ?? exhausted();
}

function exhausted<T>(): RawPage<T> {
  return { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] };
}

function actionsCheckRunIds(pullRequest: RawPullRequest): string[] {
  const ids: string[] = [];

  for (const { commit } of present(pullRequest.commits.nodes)) {
    for (const suite of present(commit.checkSuites?.nodes ?? [])) {
      if (suite.app?.slug !== ACTIONS_APP_SLUG) {
        continue;
      }

      for (const checkRun of present(suite.checkRuns?.nodes ?? [])) {
        ids.push(checkRun.id);
      }
    }
  }

  return ids;
}

type RawCheckRunSteps = {
  id: string;
  steps: RawPage<RawStep> | null;
};

async function fetchSteps(run: Run, ids: string[]): Promise<Record<string, RawPage<RawStep>>> {
  const steps: Record<string, RawPage<RawStep>> = {};

  for (let start = 0; start < ids.length; start += STEP_BATCH_SIZE) {
    const batch = ids.slice(start, start + STEP_BATCH_SIZE);
    const data = await run<{ nodes: (RawCheckRunSteps | null)[] }>(CHECK_RUN_STEPS_QUERY, { ids: batch });

    for (const checkRun of present(data.nodes)) {
      const page = checkRun.steps ?? exhausted<RawStep>();

      await drain(page, (cursor) =>
        nodePage(run, MORE_CHECK_RUN_STEPS_QUERY, { id: checkRun.id, cursor }, (node: RawCheckRunSteps) => node.steps),
      );

      steps[checkRun.id] = page;
    }
  }

  return steps;
}
