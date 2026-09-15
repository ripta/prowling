// Raw response to model. A pure mapping over drained pages: every connection has already been
// paged to the end, so this reads nodes and skips the null holes.

import type { Degradation } from "./github/errors";
import {
  ACTIONS_APP_SLUG,
  present,
  type PullRequestData,
  type RawActor,
  type RawCheckRun,
  type RawCheckSuite,
  type RawCommit,
  type RawPage,
  type RawReviewComment,
  type RawReviewRequest,
  type RawReviewThread,
  type RawStep,
  type RawTimelineItem,
} from "./github/query";
import type {
  Actor,
  Check,
  CheckConclusion,
  CheckProvider,
  CheckStatus,
  CheckSuite,
  Commit,
  DiffSide,
  MergeableState,
  PullRequest,
  PullRequestState,
  ReviewComment,
  ReviewDecision,
  ReviewRequest,
  ReviewState,
  ReviewThread,
  Step,
  TimelineItem,
} from "./model";

const CLOUD_BUILD_APP_SLUG = "google-cloud-build";

export function normalizePullRequest(
  data: PullRequestData,
  degradations: Degradation[],
): PullRequest {
  const raw = data.pullRequest;

  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: actor(raw.author),
    body: raw.body,
    bodyText: raw.bodyText,
    state: raw.state as PullRequestState,
    isDraft: raw.isDraft,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    closedAt: raw.closedAt,
    mergedAt: raw.mergedAt,
    mergeable: raw.mergeable as MergeableState,
    reviewDecision: raw.reviewDecision as ReviewDecision | null,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    headRefOid: raw.headRefOid,
    isCrossRepository: raw.isCrossRepository,
    headRepository: raw.headRepository?.nameWithOwner ?? null,
    viewer: {
      login: data.viewer.login,
      didAuthor: raw.viewerDidAuthor,
      latestReview:
        raw.viewerLatestReview === null
          ? null
          : {
              id: raw.viewerLatestReview.id,
              state: raw.viewerLatestReview.state as ReviewState,
              submittedAt: raw.viewerLatestReview.submittedAt,
              commitOid: raw.viewerLatestReview.commit?.oid ?? null,
            },
    },
    reviewRequests: nodes(raw.reviewRequests).map(reviewRequest),
    timeline: nodes(raw.timelineItems).map(timelineItem),
    threads: nodes(raw.reviewThreads).map(reviewThread),
    commits: present(raw.commits.nodes).map((item) => commit(item.commit, data.steps)),
    degradations,
  };
}

function nodes<T>(page: RawPage<T> | null): T[] {
  return page === null ? [] : present(page.nodes);
}

function actor(raw: RawActor | null): Actor | null {
  return raw === null ? null : { login: raw.login, kind: raw.__typename };
}

function reviewRequest(raw: RawReviewRequest): ReviewRequest {
  const reviewer = raw.requestedReviewer;

  if (reviewer === null) {
    return { id: raw.id, reviewer: null };
  }

  if (reviewer.__typename === "Team") {
    return { id: raw.id, reviewer: { kind: "Team", login: reviewer.combinedSlug } };
  }

  return { id: raw.id, reviewer: { kind: reviewer.__typename, login: reviewer.login } };
}

function timelineItem(raw: RawTimelineItem): TimelineItem {
  switch (raw.__typename) {
    case "PullRequestCommit":
      return { kind: "commit", id: raw.id, oid: raw.commit.oid };

    case "PullRequestReview":
      return {
        kind: "review",
        id: raw.id,
        author: actor(raw.author),
        state: raw.state as ReviewState,
        body: raw.body,
        bodyText: raw.bodyText,
        submittedAt: raw.submittedAt,
        commitOid: raw.commit?.oid ?? null,
        url: raw.url,
        isMinimized: raw.isMinimized,
      };

    case "IssueComment":
      return {
        kind: "comment",
        id: raw.id,
        author: actor(raw.author),
        body: raw.body,
        bodyText: raw.bodyText,
        createdAt: raw.createdAt,
        url: raw.url,
        isMinimized: raw.isMinimized,
        minimizedReason: raw.minimizedReason,
      };

    case "HeadRefForcePushedEvent":
      return {
        kind: "force-push",
        id: raw.id,
        actor: actor(raw.actor),
        createdAt: raw.createdAt,
        beforeOid: raw.beforeCommit?.oid ?? null,
        afterOid: raw.afterCommit?.oid ?? null,
      };
  }
}

function reviewThread(raw: RawReviewThread): ReviewThread {
  return {
    id: raw.id,
    path: raw.path,
    line: raw.line,
    startLine: raw.startLine,
    originalLine: raw.originalLine,
    originalStartLine: raw.originalStartLine,
    diffSide: raw.diffSide as DiffSide,
    isResolved: raw.isResolved,
    isOutdated: raw.isOutdated,
    isCollapsed: raw.isCollapsed,
    resolvedBy: actor(raw.resolvedBy),
    comments: present(raw.comments.nodes).map(reviewComment),
  };
}

function reviewComment(raw: RawReviewComment): ReviewComment {
  return {
    id: raw.id,
    author: actor(raw.author),
    body: raw.body,
    bodyText: raw.bodyText,
    createdAt: raw.createdAt,
    url: raw.url,
    diffHunk: raw.diffHunk,
    path: raw.path,
    line: raw.line,
    originalLine: raw.originalLine,
    outdated: raw.outdated,
    commitOid: raw.commit?.oid ?? null,
    originalCommitOid: raw.originalCommit?.oid ?? null,
    reviewId: raw.pullRequestReview?.id ?? null,
    replyToId: raw.replyTo?.id ?? null,
    isMinimized: raw.isMinimized,
  };
}

function commit(raw: RawCommit, steps: PullRequestData["steps"]): Commit {
  return {
    id: raw.id,
    oid: raw.oid,
    abbreviatedOid: raw.abbreviatedOid,
    messageHeadline: raw.messageHeadline,
    committedDate: raw.committedDate,
    authoredDate: raw.authoredDate,
    author: {
      name: raw.author?.name ?? null,
      user: actor(raw.author?.user ?? null),
    },
    checkSuites: nodes(raw.checkSuites).map((suite) => checkSuite(suite, steps)),
  };
}

function checkSuite(raw: RawCheckSuite, steps: PullRequestData["steps"]): CheckSuite {
  const provider = providerOf(raw.app?.slug);

  return {
    id: raw.id,
    app: raw.app,
    status: raw.status as CheckStatus,
    conclusion: raw.conclusion as CheckConclusion | null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    url: raw.url,
    push:
      raw.push === null
        ? null
        : {
            id: raw.push.id,
            previousSha: raw.push.previousSha,
            nextSha: raw.push.nextSha,
            pusher: { login: raw.push.pusher.login, kind: raw.push.pusher.__typename },
          },
    workflowRun:
      raw.workflowRun === null
        ? null
        : {
            id: raw.workflowRun.id,
            url: raw.workflowRun.url,
            workflowName: raw.workflowRun.workflow.name,
          },
    checks: nodes(raw.checkRuns).map((run) => check(run, provider, nodes(steps[run.id] ?? null))),
  };
}

// The provider is a property of the app that owns the check suite. A later provider layer keys off
// this; the suite keeps the app slug and name so the raw fact is not lost.
function providerOf(slug: string | undefined): CheckProvider {
  switch (slug) {
    case ACTIONS_APP_SLUG:
      return "actions";
    case CLOUD_BUILD_APP_SLUG:
      return "cloud-build";
    default:
      return "generic";
  }
}

function check(raw: RawCheckRun, provider: CheckProvider, steps: RawStep[]): Check {
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status as CheckStatus,
    conclusion: raw.conclusion as CheckConclusion | null,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    detailsUrl: raw.detailsUrl,
    url: raw.url,
    provider,
    summaryText: raw.summary,
    title: raw.title,
    isRequired: raw.isRequired,
    steps: steps.map(step),
  };
}

function step(raw: RawStep): Step {
  return {
    number: raw.number,
    name: raw.name,
    status: raw.status as CheckStatus,
    conclusion: raw.conclusion as CheckConclusion | null,
    durationSeconds: raw.secondsToCompletion,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
  };
}
