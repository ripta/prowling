// The revision chain and the anchoring of items onto it. A revision is one state of the head ref.
// Push records on check suites and force-push events in the timeline each describe a state, and
// where both describe the same one they are cross-checked. Items then anchor by commit oid where
// they carry one, and by timestamp otherwise.
//
// Plain records in, plain data out. The normalizer adapts the raw response into ChainInput, so
// this module never sees a wire shape and its tests build inputs by hand.

import type { Degradation } from "./github/errors";
import type { Actor, Anchor, Revision } from "./model";

// The API reports a push that created the branch with this previousSha.
export const ZERO_OID = "0000000000000000000000000000000000000000";

// A push record and a force-push event for the same head are one push seen twice. The event
// carries the moment of the push. The earliest suite on that push is created within seconds of
// it; later suites lag by up to an hour. So pushedAt takes the minimum across suites sharing a
// push id, and the tolerance applies to that minimum.
export const CROSS_CHECK_TOLERANCE_MS = 60_000;

export type PushRecord = {
  id: string;
  previousSha: string | null;
  nextSha: string | null;
  pusher: Actor;
  createdAt: string;
  // The commit whose check suite carried the record. A record whose nextSha is some other commit
  // describes a push to another ref, and is ignored.
  commitOid: string;
};

export type ForcePushEvent = {
  id: string;
  beforeOid: string | null;
  afterOid: string | null;
  createdAt: string;
  actor: Actor | null;
};

export type ChainInput = {
  headRefOid: string;
  // Surviving commits, base to head.
  commits: string[];
  pushes: PushRecord[];
  // Timeline order.
  events: ForcePushEvent[];
  // Dropped heads whose commit came back from the lookup.
  resolved: Set<string>;
};

export type RevisionChain = {
  revisions: Revision[];
  degradations: Degradation[];
  // The revision a commit belongs to: its own when the oid is a head, or the one that introduced
  // it when it survives on the branch. undefined for any other oid. When a head has several
  // revisions, at picks the latest one pushed at or before that moment.
  byCommit(oid: string, at?: string | null): Anchor | undefined;
  // The revision that was head at that moment. Only revisions with a known time count. A moment
  // before all of them maps to the first revision. A null moment maps to the newest.
  byTime(at: string | null): Anchor;
  // byCommit, then byTime.
  anchor(oid: string | null, at: string | null): Anchor;
};

type Draft = {
  headOid: string;
  previousOid: string | null;
  pushedAt: string | null;
  pusher: Actor | null;
  origin: Revision["origin"];
  pushId: string | null;
  eventId: string | null;
  commits: string[];
  pred: Draft | null;
  index: number;
};

type Pending = { draft: Draft | null; message: string };

export function buildRevisionChain(input: ChainInput): RevisionChain {
  const drafts: Draft[] = [];
  const byHead = new Map<string, Draft[]>();
  const pending: Pending[] = [];

  const add = (draft: Omit<Draft, "pred" | "index">): Draft => {
    const full = { ...draft, pred: null, index: -1 };
    drafts.push(full);
    byHead.set(full.headOid, [...(byHead.get(full.headOid) ?? []), full]);
    return full;
  };

  const degrade = (draft: Draft | null, message: string): void => {
    pending.push({ draft, message });
  };

  // 1. Push records, one revision per push id. Several suites share a push, and the earliest
  // suite is the one created moments after it.
  const pushes = new Map<string, Draft>();
  const accepted: PushRecord[] = [];

  for (const record of input.pushes) {
    if (record.nextSha === null || record.nextSha !== record.commitOid) {
      continue;
    }

    accepted.push(record);

    const existing = pushes.get(record.id);
    if (existing !== undefined) {
      if (existing.pushedAt === null || parse(record.createdAt) < parse(existing.pushedAt)) {
        existing.pushedAt = record.createdAt;
      }

      continue;
    }

    pushes.set(
      record.id,
      add({
        headOid: record.nextSha,
        previousOid: record.previousSha,
        pushedAt: record.createdAt,
        pusher: record.pusher,
        origin: "push",
        pushId: record.id,
        eventId: null,
        commits: [],
      }),
    );
  }

  // 2. Force-push events. An event claims the push record for its after commit when one exists,
  // and the two are cross-checked. A head already claimed by an earlier event gets a second
  // revision, which is a force-push away and back.
  for (const event of input.events) {
    if (event.afterOid === null) {
      degrade(null, `Force-push ${event.id} at ${event.createdAt} names no after commit.`);
      continue;
    }

    const candidates = (byHead.get(event.afterOid) ?? []).filter((draft) => draft.eventId === null);
    const target =
      candidates.find((draft) => draft.previousOid === event.beforeOid) ?? candidates[0] ?? null;

    if (target === null) {
      add({
        headOid: event.afterOid,
        previousOid: event.beforeOid,
        pushedAt: event.createdAt,
        pusher: event.actor,
        origin: "force-push",
        pushId: null,
        eventId: event.id,
        commits: [],
      });

      continue;
    }

    if (target.previousOid !== event.beforeOid) {
      degrade(
        target,
        `Push record and force-push event disagree on the predecessor of ${short(event.afterOid)}: ` +
          `${short(target.previousOid)} against ${short(event.beforeOid)}.`,
      );
    }

    if (target.pushedAt !== null && Math.abs(parse(target.pushedAt) - parse(event.createdAt)) > CROSS_CHECK_TOLERANCE_MS) {
      degrade(
        target,
        `Push record at ${target.pushedAt} and force-push event at ${event.createdAt} for ` +
          `${short(event.afterOid)} are more than ${CROSS_CHECK_TOLERANCE_MS / 1000} seconds apart.`,
      );
    }

    target.origin = "force-push";
    target.pushedAt = event.createdAt;
    target.pusher = event.actor ?? target.pusher;
    target.previousOid = event.beforeOid ?? target.previousOid;
    target.eventId = event.id;
  }

  // 3. Inferred revisions. A state that only appears as a predecessor still existed, so it gets a
  // revision with no time. A push's previousSha counts only when it names a surviving commit,
  // because a branch created in the web UI records a base-branch commit there instead.
  //
  // A force-push's before is accounted for when a revision with that head existed by the time of
  // the event. One that only exists later is a different state of the same oid, which happens
  // when a force-push moves away from a head and a later one moves back. A push record's
  // predecessor is accounted for by any revision with that head: an ordinary push cannot move
  // back, and the suite time lags too much to compare.
  const survivors = new Set(input.commits);

  const infer = (oid: string, replacedAt?: string): void => {
    const known = (byHead.get(oid) ?? []).some(
      (draft) =>
        draft.pushedAt === null || replacedAt === undefined || parse(draft.pushedAt) <= parse(replacedAt),
    );

    if (known) {
      return;
    }

    add({
      headOid: oid,
      previousOid: null,
      pushedAt: null,
      pusher: null,
      origin: "inferred",
      pushId: null,
      eventId: null,
      commits: [],
    });
  };

  for (const event of input.events) {
    if (event.beforeOid !== null) {
      infer(event.beforeOid, event.createdAt);
    }
  }

  for (const record of accepted) {
    if (record.previousSha !== null && survivors.has(record.previousSha)) {
      infer(record.previousSha);
    }
  }

  const last = input.commits[input.commits.length - 1];
  if (last === undefined) {
    infer(input.headRefOid);
  } else {
    if (last !== input.headRefOid) {
      degrade(
        null,
        `Head ${short(input.headRefOid)} is not the last commit on the branch, ${short(last)}. ` +
          "The commit list is stale.",
      );
    }

    infer(last);
  }

  // 4. Order by chain links, then by time. Each timestamped revision links to the revision whose
  // head is its predecessor. Walking the links from each root yields segments; a gap between
  // segments is a stretch of pushes nothing recorded. Segments sort by their first known time.
  for (const draft of drafts) {
    if (draft.pushedAt === null || draft.previousOid === null || draft.previousOid === ZERO_OID) {
      continue;
    }

    const candidates = byHead.get(draft.previousOid);
    if (candidates === undefined) {
      continue;
    }

    const at = parse(draft.pushedAt);
    const earlier = candidates.filter((candidate) => candidate.pushedAt !== null && parse(candidate.pushedAt) <= at);

    draft.pred =
      latest(earlier) ?? candidates.find((candidate) => candidate.pushedAt === null) ?? earliest(candidates) ?? null;
  }

  const successors = new Map<Draft, Draft[]>();
  for (const draft of drafts) {
    if (draft.pred !== null) {
      successors.set(draft.pred, [...(successors.get(draft.pred) ?? []), draft]);
    }
  }

  const visited = new Set<Draft>();
  const segments: Draft[][] = [];

  const walk = (draft: Draft, segment: Draft[]): void => {
    if (visited.has(draft)) {
      return;
    }

    visited.add(draft);
    segment.push(draft);

    for (const next of byPushedAt(successors.get(draft) ?? [])) {
      walk(next, segment);
    }
  };

  for (const root of drafts) {
    if (root.pred === null) {
      const segment: Draft[] = [];
      walk(root, segment);
      segments.push(segment);
    }
  }

  // A cycle would leave its members unvisited. Two force-pushes swapping heads within one second
  // is the only way to get one.
  for (const draft of drafts) {
    if (!visited.has(draft)) {
      const segment: Draft[] = [];
      walk(draft, segment);
      segments.push(segment);
    }
  }

  segments.sort((a, b) => segmentTime(a) - segmentTime(b));

  const ordered = segments.flat();
  ordered.forEach((draft, index) => {
    draft.index = index;
  });

  for (const segment of segments) {
    let previous: Draft | null = null;

    for (const draft of segment) {
      if (draft.pushedAt === null) {
        continue;
      }

      if (previous !== null && previous.pushedAt !== null && parse(draft.pushedAt) < parse(previous.pushedAt)) {
        degrade(
          draft,
          `Revision ${short(draft.headOid)} at ${draft.pushedAt} follows revision ` +
            `${short(previous.headOid)} at ${previous.pushedAt}.`,
        );
      }

      previous = draft;
    }
  }

  // 5. Surviving commits belong to the first head at or after them on the branch. A push of
  // several commits records only its tip, so the commits below the tip ride with it. A dropped
  // head that resolved owns itself.
  const position = new Map(input.commits.map((oid, index) => [oid, index] as const));
  const headPositions = [...new Set(drafts.map((draft) => position.get(draft.headOid)).filter(defined))].sort(
    (a, b) => a - b,
  );
  const assigned = new Map<string, Draft>();

  let cursor = 0;
  for (const [index, oid] of input.commits.entries()) {
    while (cursor < headPositions.length && headPositions[cursor] < index) {
      cursor += 1;
    }

    // The last commit is always a head, so the cursor never runs off the end.
    if (cursor >= headPositions.length) {
      break;
    }

    const headOid = input.commits[headPositions[cursor]];
    const draft = earliestByIndex(byHead.get(headOid) ?? []);
    if (draft === undefined) {
      continue;
    }

    draft.commits.push(oid);
    assigned.set(oid, draft);
  }

  const owned = new Set<string>();
  for (const draft of ordered) {
    if (!survivors.has(draft.headOid) && input.resolved.has(draft.headOid) && !owned.has(draft.headOid)) {
      draft.commits.push(draft.headOid);
      owned.add(draft.headOid);
    }
  }

  const revisions: Revision[] = ordered.map((draft) => ({
    headOid: draft.headOid,
    previousOid: draft.previousOid,
    pushedAt: draft.pushedAt,
    pusher: draft.pusher,
    origin: draft.origin,
    pushId: draft.pushId,
    eventId: draft.eventId,
    commits: draft.commits,
  }));

  const degradations: Degradation[] = pending.map(({ draft, message }) => ({
    path: draft === null ? ["revisions"] : ["revisions", draft.index],
    message,
  }));

  const byCommit = (oid: string, at?: string | null): Anchor | undefined => {
    const candidates = byHead.get(oid);

    if (candidates !== undefined) {
      const byMoment = at === null || at === undefined ? undefined : latestAtOrBefore(candidates, parse(at));
      const chosen = byMoment ?? earliestByIndex(candidates) ?? candidates[0];

      return { revision: chosen.index, by: "commit" };
    }

    const draft = assigned.get(oid);
    return draft === undefined ? undefined : { revision: draft.index, by: "commit" };
  };

  const byTime = (at: string | null): Anchor => {
    if (at === null) {
      return { revision: revisions.length - 1, by: "fallback" };
    }

    const moment = parse(at);
    let found = -1;

    for (const draft of ordered) {
      if (draft.pushedAt !== null && parse(draft.pushedAt) <= moment) {
        found = draft.index;
      }
    }

    return { revision: found === -1 ? 0 : found, by: "timestamp" };
  };

  const anchor = (oid: string | null, at: string | null): Anchor =>
    (oid === null ? undefined : byCommit(oid, at)) ?? byTime(at);

  return { revisions, degradations, byCommit, byTime, anchor };
}

// The heads that may need resolving: everything a push record or a force-push event names, minus
// what is still on the branch. Sorted, so a batch built from it is the same on every run.
//
// headRefOid is never in it. When it is not on the branch the commit list is stale, which a
// lookup would not fix. A push's previousSha is not in it either, for the reason given in
// buildRevisionChain.
export function droppedHeadOids(input: {
  commits: string[];
  pushes: Pick<PushRecord, "nextSha" | "commitOid">[];
  events: Pick<ForcePushEvent, "beforeOid" | "afterOid">[];
}): string[] {
  const survivors = new Set(input.commits);
  const oids = new Set<string>();

  for (const record of input.pushes) {
    if (record.nextSha !== null && record.nextSha === record.commitOid) {
      oids.add(record.nextSha);
    }
  }

  for (const event of input.events) {
    if (event.beforeOid !== null) {
      oids.add(event.beforeOid);
    }

    if (event.afterOid !== null) {
      oids.add(event.afterOid);
    }
  }

  return [...oids].filter((oid) => !survivors.has(oid)).sort();
}

function parse(iso: string): number {
  return Date.parse(iso);
}

function short(oid: string | null): string {
  return oid === null ? "unknown" : oid.slice(0, 7);
}

function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// Drafts without a time sort last.
function byPushedAt(drafts: Draft[]): Draft[] {
  const time = (draft: Draft): number => (draft.pushedAt === null ? Number.POSITIVE_INFINITY : parse(draft.pushedAt));

  return [...drafts].sort((a, b) => time(a) - time(b));
}

function latest(drafts: Draft[]): Draft | undefined {
  return byPushedAt(drafts).at(-1);
}

function earliest(drafts: Draft[]): Draft | undefined {
  return byPushedAt(drafts.filter((draft) => draft.pushedAt !== null))[0];
}

function earliestByIndex(drafts: Draft[]): Draft | undefined {
  return [...drafts].sort((a, b) => a.index - b.index)[0];
}

function latestAtOrBefore(drafts: Draft[], moment: number): Draft | undefined {
  return latest(drafts.filter((draft) => draft.pushedAt !== null && parse(draft.pushedAt) <= moment));
}

// A segment with no known time is the inferred current head on its own, and sorts last.
function segmentTime(segment: Draft[]): number {
  const first = segment.find((draft) => draft.pushedAt !== null);
  if (first === undefined || first.pushedAt === null) {
    return Number.POSITIVE_INFINITY;
  }

  return parse(first.pushedAt);
}
