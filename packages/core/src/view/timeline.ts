// The timeline, grouped by revision. Every item in the model already knows the revision it belongs
// to, so this bucket-sorts by that anchor rather than deciding anything about anchoring itself.
//
// Three kinds of thing land in a group. Reviews and issue comments come off the timeline, each
// carrying its own anchor. A review thread has no anchor of its own, so it lands where its first
// comment does: the revision whose code the feedback was written against, not wherever a later reply
// happened to fall. Check runs have no anchor either, and reach a revision through the commit that
// owns them, which is the join the check rows already make.
//
// Two timeline kinds produce no entry. A force-push is the revision's own origin and pusher, and a
// commit is one of the commits the revision lists. Either would repeat what the group header says.

import type {
  Actor,
  CheckConclusion,
  CheckStatus,
  Revision,
  ReviewState,
  ReviewThread,
  TimelineItem,
} from "../model";
import { type CheckCommit, type CheckRun, isFailingConclusion, revisionIndexByOid } from "./checks";

// PullRequest satisfies this structurally.
export type TimelineInput = {
  revisions: readonly Revision[];
  timeline: readonly TimelineItem[];
  threads: readonly ReviewThread[];
  commits: readonly CheckCommit[];
  droppedCommits: readonly CheckCommit[];
};

export type TimelineEntry = ChecksEntry | ReviewEntry | ThreadEntry | CommentEntry;

// What CI did on this revision, rather than what it says now. The state header answers the second
// question, and answers it once per check name across the whole pull request.
//
// The counts are per name, so a re-run replaces the result it was standing in for. They need not add
// up to the total: a conclusion that is neither a pass, a failure, nor a skip lands in other.
export type ChecksEntry = {
  kind: "checks";
  total: number;
  // Worth acting on, in the order the runs were read.
  failing: FailedRun[];
  pending: number;
  passing: number;
  skipped: number;
  other: number;
};

export type FailedRun = {
  checkId: string;
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  detailsUrl: string | null;
};

export type ReviewEntry = {
  kind: "review";
  id: string;
  author: Actor | null;
  state: ReviewState;
  bodyText: string;
  at: string | null;
  url: string;
  isMinimized: boolean;
};

// The thread's first comment supplies the author and the body. Replies are counted rather than
// listed, which keeps a long argument to one row until the detail pane can open it.
export type ThreadEntry = {
  kind: "thread";
  id: string;
  author: Actor | null;
  bodyText: string;
  at: string;
  path: string;
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  replies: number;
};

export type CommentEntry = {
  kind: "comment";
  id: string;
  author: Actor | null;
  bodyText: string;
  at: string;
  url: string;
  isMinimized: boolean;
};

export type TimelineGroup = {
  // Indexes TimelineInput.revisions.
  index: number;
  revision: Revision;
  // The checks entry leads. Everything else is in the order it happened.
  entries: TimelineEntry[];
  // The default the view opens with, not live state. The newest revision, and any revision where an
  // unresolved thread started.
  startsExpanded: boolean;
  // Unresolved threads that started here.
  unresolved: number;
};

type Draft = {
  index: number;
  revision: Revision;
  items: TimelineEntry[];
  unresolved: number;
};

export function deriveTimeline(input: TimelineInput): TimelineGroup[] {
  const drafts: Draft[] = input.revisions.map((revision, index) => ({
    index,
    revision,
    items: [],
    unresolved: 0,
  }));

  for (const item of input.timeline) {
    const draft = drafts[item.anchor.revision];

    if (draft === undefined) {
      continue;
    }

    if (item.kind === "review") {
      draft.items.push({
        kind: "review",
        id: item.id,
        author: item.author,
        state: item.state,
        bodyText: item.bodyText,
        at: item.submittedAt,
        url: item.url,
        isMinimized: item.isMinimized,
      });
    }

    if (item.kind === "comment") {
      draft.items.push({
        kind: "comment",
        id: item.id,
        author: item.author,
        bodyText: item.bodyText,
        at: item.createdAt,
        url: item.url,
        isMinimized: item.isMinimized,
      });
    }
  }

  for (const thread of input.threads) {
    // A thread the API returned with no comments has nothing to place and nothing to show.
    const first = thread.comments[0];

    if (first === undefined) {
      continue;
    }

    const draft = drafts[first.anchor.revision];

    if (draft === undefined) {
      continue;
    }

    draft.items.push({
      kind: "thread",
      id: thread.id,
      author: first.author,
      bodyText: first.bodyText,
      at: first.createdAt,
      path: thread.path,
      line: thread.line ?? thread.originalLine,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      replies: thread.comments.length - 1,
    });

    if (!thread.isResolved) {
      draft.unresolved += 1;
    }
  }

  const checks = checksByRevision(input);
  const newest = drafts.length - 1;

  return drafts.map((draft) => {
    const entry = checks.get(draft.index);
    const ordered = [...draft.items].sort(byTime);

    return {
      index: draft.index,
      revision: draft.revision,
      entries: entry === undefined ? ordered : [entry, ...ordered],
      startsExpanded: draft.index === newest || draft.unresolved > 0,
      unresolved: draft.unresolved,
    };
  });
}

// A revision with no runs at all gets no entry, for the same reason the header omits a check that
// never ran and gates nothing. There is nothing to say about CI that did not happen.
function checksByRevision(input: TimelineInput): Map<number, ChecksEntry> {
  const byOid = revisionIndexByOid(input.revisions);
  const byRevision = new Map<number, Map<string, CheckRun>>();

  for (const commit of [...input.commits, ...input.droppedCommits]) {
    const index = byOid.get(commit.oid);

    if (index === undefined) {
      continue;
    }

    const byName = byRevision.get(index) ?? new Map<string, CheckRun>();
    byRevision.set(index, byName);

    for (const suite of commit.checkSuites) {
      for (const run of suite.checks) {
        const held = byName.get(run.name);

        if (held === undefined || stamp(run) > stamp(held)) {
          byName.set(run.name, run);
        }
      }
    }
  }

  const entries = new Map<number, ChecksEntry>();

  for (const [index, byName] of byRevision) {
    const runs = [...byName.values()];

    if (runs.length > 0) {
      entries.set(index, checksEntry(runs));
    }
  }

  return entries;
}

function checksEntry(runs: CheckRun[]): ChecksEntry {
  const failing = runs.filter((run) => isFailingConclusion(run.conclusion));
  const pending = runs.filter((run) => run.conclusion === null && run.status !== "COMPLETED");
  const passing = runs.filter((run) => run.conclusion === "SUCCESS");
  const skipped = runs.filter((run) => run.conclusion === "SKIPPED");

  return {
    kind: "checks",
    total: runs.length,
    failing: failing.map((run) => ({
      checkId: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      detailsUrl: run.detailsUrl,
    })),
    pending: pending.length,
    passing: passing.length,
    skipped: skipped.length,
    other: runs.length - failing.length - pending.length - passing.length - skipped.length,
  };
}

function byTime(left: TimelineEntry, right: TimelineEntry): number {
  const a = moment(left);
  const b = moment(right);

  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

// The checks entry never reaches here, and only an unsubmitted review has no time. Sorting it last
// puts a review still being drafted after the conversation it has not joined yet.
function moment(entry: TimelineEntry): number {
  if (entry.kind === "checks") {
    return 0;
  }

  return entry.at === null ? Number.POSITIVE_INFINITY : parse(entry.at);
}

function stamp(run: CheckRun): number {
  return parse(run.completedAt) || parse(run.startedAt);
}

function parse(value: string | null): number {
  if (value === null) {
    return 0;
  }

  const time = Date.parse(value);

  return Number.isNaN(time) ? 0 : time;
}
