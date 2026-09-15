// The normalized shape of one pull request. Plain data, no methods, so it serializes as JSON and
// transfers unchanged to the extension.
//
// Every object the API exposes as a Node keeps its GraphQL id. Read-only today, but resolving a
// thread, reacting, or re-running a check all take a node id, and carrying it now costs nothing.
// Two shapes have no id because the API gives none: steps, which are not nodes, and actors, which
// are references to a person or app rather than objects of the pull request.

import type { Degradation } from "./github/errors";

export type Actor = {
  login: string;
  // The GraphQL typename: User, Bot, Mannequin, Organization, or EnterpriseUserAccount.
  kind: string;
};

export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

export type MergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

export type ReviewState = "PENDING" | "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED";

export type CheckStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "WAITING" | "PENDING" | "REQUESTED";

export type CheckConclusion =
  | "ACTION_REQUIRED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "FAILURE"
  | "SUCCESS"
  | "NEUTRAL"
  | "SKIPPED"
  | "STARTUP_FAILURE"
  | "STALE";

export type DiffSide = "LEFT" | "RIGHT";

export type CheckProvider = "actions" | "cloud-build" | "generic";

export type PullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  author: Actor | null;
  body: string;
  bodyText: string;
  state: PullRequestState;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergeable: MergeableState;
  reviewDecision: ReviewDecision | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  headRepository: string | null;
  viewer: Viewer;
  reviewRequests: ReviewRequest[];
  timeline: TimelineItem[];
  threads: ReviewThread[];
  commits: Commit[];
  degradations: Degradation[];
};

export type Viewer = {
  login: string;
  didAuthor: boolean;
  latestReview: LatestReview | null;
};

export type LatestReview = {
  id: string;
  state: ReviewState;
  submittedAt: string | null;
  commitOid: string | null;
};

export type ReviewRequest = {
  id: string;
  reviewer: Reviewer | null;
};

export type Reviewer = {
  // User, Team, Bot, or Mannequin. A team's login is its combined slug, org/team.
  kind: string;
  login: string;
};

// Timeline items keep the order the API returns them in. Anchoring them to revisions is a separate
// step over this list.
export type TimelineItem = CommitItem | ReviewItem | CommentItem | ForcePushItem;

// The full commit lives in PullRequest.commits. This item marks where it sits in the timeline, and
// its id is the PullRequestCommit node rather than the Commit node.
export type CommitItem = {
  kind: "commit";
  id: string;
  oid: string;
};

export type ReviewItem = {
  kind: "review";
  id: string;
  author: Actor | null;
  state: ReviewState;
  body: string;
  bodyText: string;
  submittedAt: string | null;
  commitOid: string | null;
  url: string;
  isMinimized: boolean;
};

export type CommentItem = {
  kind: "comment";
  id: string;
  author: Actor | null;
  body: string;
  bodyText: string;
  createdAt: string;
  url: string;
  isMinimized: boolean;
  minimizedReason: string | null;
};

export type ForcePushItem = {
  kind: "force-push";
  id: string;
  actor: Actor | null;
  createdAt: string;
  beforeOid: string | null;
  afterOid: string | null;
};

export type ReviewThread = {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: DiffSide;
  isResolved: boolean;
  isOutdated: boolean;
  isCollapsed: boolean;
  resolvedBy: Actor | null;
  comments: ReviewComment[];
};

export type ReviewComment = {
  id: string;
  author: Actor | null;
  body: string;
  bodyText: string;
  createdAt: string;
  url: string;
  diffHunk: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  outdated: boolean;
  commitOid: string | null;
  originalCommitOid: string | null;
  reviewId: string | null;
  replyToId: string | null;
  isMinimized: boolean;
};

export type Commit = {
  id: string;
  oid: string;
  abbreviatedOid: string;
  messageHeadline: string;
  committedDate: string;
  authoredDate: string;
  author: CommitAuthor;
  checkSuites: CheckSuite[];
};

export type CommitAuthor = {
  name: string | null;
  user: Actor | null;
};

export type CheckSuite = {
  id: string;
  app: App | null;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  push: Push | null;
  workflowRun: WorkflowRun | null;
  checks: Check[];
};

export type App = {
  slug: string;
  name: string;
};

export type Push = {
  id: string;
  previousSha: string | null;
  nextSha: string | null;
  pusher: Actor;
};

export type WorkflowRun = {
  id: string;
  url: string;
  workflowName: string;
};

export type Check = {
  id: string;
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  url: string;
  provider: CheckProvider;
  summaryText: string | null;
  title: string | null;
  isRequired: boolean;
  steps: Step[];
};

export type Step = {
  number: number;
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  durationSeconds: number | null;
  startedAt: string | null;
  completedAt: string | null;
};
