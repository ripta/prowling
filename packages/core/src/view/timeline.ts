// The timeline, grouped by revision. Every item in the model already knows the revision it belongs
// to, so this bucket-sorts by that anchor rather than deciding anything about anchoring itself.
//
// Three kinds of thing land in a group. Reviews and issue comments come off the timeline, each
// carrying its own anchor. A review thread has no anchor of its own, so it lands where its first
// comment does: the revision whose code the feedback was written against, not wherever a later reply
// happened to fall.
//
// Checks are not among them. The state header is the only surface that answers a check question, so
// the timeline stays the conversation it exists to show.
//
// Two timeline kinds produce no entry. A force-push is the revision's own origin and pusher, and a
// commit is one of the commits the revision lists. Either would repeat what the group header says.

import type { Actor, Revision, ReviewState, ReviewThread, TimelineItem } from "../model";

// PullRequest satisfies this structurally.
export type TimelineInput = {
  revisions: readonly Revision[];
  timeline: readonly TimelineItem[];
  threads: readonly ReviewThread[];
};

export type TimelineEntry = ReviewEntry | ThreadEntry | CommentEntry;

export type ReviewEntry = {
  kind: "review";
  id: string;
  author: Actor | null;
  state: ReviewState;
  bodyText: string;
  body: string;
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
  body: string;
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
  body: string;
  at: string;
  url: string;
  isMinimized: boolean;
};

export type TimelineGroup = {
  // Indexes TimelineInput.revisions.
  index: number;
  revision: Revision;
  // In the order it happened.
  entries: TimelineEntry[];
  // The default the view opens with, not live state. The revision the view opens on, and any
  // revision where an unresolved thread started.
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
        body: item.body,
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
        body: item.body,
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
      body: first.body,
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

  const opens = newestHolding(drafts.map((draft) => draft.items.length));

  return drafts.map((draft) => ({
    index: draft.index,
    revision: draft.revision,
    entries: [...draft.items].sort(byTime),
    startsExpanded: draft.index === opens || draft.unresolved > 0,
    unresolved: draft.unresolved,
  }));
}

// The revision the view opens on, and where its cursor starts.
//
// Most revisions carry no conversation. A push that nobody commented on produces a group with
// nothing in it, and a pull request is usually pushed once more after the last review lands. So
// opening on the newest revision opens on an empty one most of the time.
//
// A pull request with no conversation anywhere has nothing better to offer, and opens at the newest.
export function openingRevision(groups: readonly TimelineGroup[]): number {
  return newestHolding(groups.map((group) => group.entries.length));
}

function newestHolding(counts: readonly number[]): number {
  for (let index = counts.length - 1; index >= 0; index -= 1) {
    if ((counts[index] ?? 0) > 0) {
      return index;
    }
  }

  return Math.max(0, counts.length - 1);
}

function byTime(left: TimelineEntry, right: TimelineEntry): number {
  const a = moment(left);
  const b = moment(right);

  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

// Only an unsubmitted review has no time. Sorting it last puts a review still being drafted after
// the conversation it has not joined yet.
function moment(entry: TimelineEntry): number {
  return entry.at === null ? Number.POSITIVE_INFINITY : parse(entry.at);
}

function parse(value: string | null): number {
  if (value === null) {
    return 0;
  }

  const time = Date.parse(value);

  return Number.isNaN(time) ? 0 : time;
}
