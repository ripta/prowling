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
  // The commits on the branch now, base to head.
  commits: Commit[];
  // Heads that a force-push removed from the branch, resolved by oid. Chain order, oldest first.
  droppedCommits: Commit[];
  // Oldest first. The last revision is the current head. Never empty.
  revisions: Revision[];
  degradations: Degradation[];
};

export type RevisionOrigin = "push" | "force-push" | "inferred";

// One state of the head ref. A push record or a force-push event establishes it with a timestamp.
// An inferred revision is a state that only shows up as another revision's predecessor, so its
// time is unknown.
export type Revision = {
  headOid: string;
  // The API's forty-zero oid is kept verbatim: the branch was created by this push.
  //
  // null means nobody recorded the predecessor. That is every inferred revision, and a force-push
  // whose before commit is gone.
  previousOid: string | null;
  pushedAt: string | null;
  pusher: Actor | null;
  origin: RevisionOrigin;
  pushId: string | null;
  eventId: string | null;
  // Oids whose data belongs here: the surviving commits this revision introduced, in branch order,
  // or the resolved head itself when it is no longer on the branch. Check runs anchor through this
  // list, since a check run belongs to its commit.
  commits: string[];
};

// Where an item sits in the revision chain. revision indexes PullRequest.revisions. Two revisions
// can share a head oid when a force-push moved away and back, so the index is the identity.
//
// by records the signal used: the item's own commit oid, its timestamp against the revision that
// was head at that moment, or neither, in which case it lands on the newest revision.
export type Anchor = {
  revision: number;
  by: "commit" | "timestamp" | "fallback";
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

// Timeline items keep the order the API returns them in. That order is by committedDate for
// commits, which is not when they reached the branch, so each item also carries its anchor into the
// revision chain.
export type TimelineItem = CommitItem | ReviewItem | CommentItem | ForcePushItem;

// The full commit lives in PullRequest.commits. This item marks where it sits in the timeline, and
// its id is the PullRequestCommit node rather than the Commit node.
export type CommitItem = {
  kind: "commit";
  id: string;
  oid: string;
  anchor: Anchor;
};

// commitOid is the head when the review was submitted. Its comments carry originalCommitOid, the
// head when each was drafted, so a review and its own comments can anchor to different revisions.
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
  anchor: Anchor;
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
  anchor: Anchor;
};

// Anchors to the revision the push created.
export type ForcePushItem = {
  kind: "force-push";
  id: string;
  actor: Actor | null;
  createdAt: string;
  beforeOid: string | null;
  afterOid: string | null;
  anchor: Anchor;
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
  anchor: Anchor;
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
