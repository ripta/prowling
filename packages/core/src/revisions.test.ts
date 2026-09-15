import { describe, expect, test } from "bun:test";

import type { Actor } from "./model";
import {
  buildRevisionChain,
  type ChainInput,
  droppedHeadOids,
  type ForcePushEvent,
  type PushRecord,
  ZERO_OID,
} from "./revisions";

const octocat: Actor = { login: "octocat", kind: "User" };
const hubot: Actor = { login: "hubot", kind: "Bot" };

// Oids are one letter repeated, so a seven-character prefix in a message still reads as the letter.
function oid(letter: string): string {
  return letter.repeat(40);
}

function push(id: string, previous: string, next: string, createdAt: string, commitOid = next): PushRecord {
  return { id, previousSha: previous, nextSha: next, pusher: octocat, createdAt, commitOid };
}

function event(id: string, before: string | null, after: string | null, createdAt: string): ForcePushEvent {
  return { id, beforeOid: before, afterOid: after, createdAt, actor: hubot };
}

function chain(input: Partial<ChainInput>) {
  const commits = input.commits ?? [];

  return buildRevisionChain({
    headRefOid: commits[commits.length - 1] ?? oid("h"),
    commits,
    pushes: [],
    events: [],
    resolved: new Set(),
    ...input,
  });
}

const [A, B, C, D, X, Y] = ["a", "b", "c", "d", "x", "y"].map(oid);

const T0 = "2025-01-01T00:00:00Z";
const T1 = "2025-01-01T01:00:00Z";
const T2 = "2025-01-01T02:00:00Z";
const T3 = "2025-01-01T03:00:00Z";

describe("push records", () => {
  test("make one revision per push, keyed by push id, timestamped by the earliest suite", () => {
    const { revisions, degradations } = chain({
      commits: [A, B, C],
      pushes: [
        push("p1", ZERO_OID, A, T0),
        push("p2", A, B, "2025-01-01T01:58:00Z"),
        push("p2", A, B, T1),
        push("p3", B, C, T2),
      ],
    });

    expect(degradations).toEqual([]);
    expect(revisions.map((revision) => revision.headOid)).toEqual([A, B, C]);
    expect(revisions.map((revision) => revision.origin)).toEqual(["push", "push", "push"]);
    expect(revisions[0].previousOid).toBe(ZERO_OID);
    expect(revisions[1].pushedAt).toBe(T1);
    expect(revisions[1].pushId).toBe("p2");
    expect(revisions[1].eventId).toBeNull();
    expect(revisions[1].pusher).toEqual(octocat);
    expect(revisions.map((revision) => revision.commits)).toEqual([[A], [B], [C]]);
  });

  test("ignore a record whose next commit is not the commit carrying it", () => {
    const { revisions } = chain({
      commits: [A],
      pushes: [push("p1", ZERO_OID, A, T0), push("p9", X, Y, T1, A)],
    });

    expect(revisions.map((revision) => revision.headOid)).toEqual([A]);
  });

  test("carry the commits below the tip of a multi-commit push", () => {
    const result = chain({ commits: [A, B, C], pushes: [push("p1", ZERO_OID, C, T0)] });

    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0].commits).toEqual([A, B, C]);
    expect(result.byCommit(A)).toEqual({ revision: 0, by: "commit" });
    expect(result.byCommit(C)).toEqual({ revision: 0, by: "commit" });
  });
});

describe("force-push events", () => {
  test("claim the push record for the same head and take its time and actor", () => {
    const { revisions, degradations } = chain({
      commits: [B],
      pushes: [push("p1", X, B, "2025-01-01T01:00:05Z")],
      events: [event("e1", X, B, T1)],
    });

    expect(degradations).toEqual([]);
    expect(revisions.map((revision) => revision.headOid)).toEqual([X, B]);
    expect(revisions[1]).toMatchObject({
      origin: "force-push",
      pushedAt: T1,
      pusher: hubot,
      pushId: "p1",
      eventId: "e1",
      previousOid: X,
    });
  });

  test("degrade when the push record names a different predecessor", () => {
    const { revisions, degradations } = chain({
      commits: [B],
      pushes: [push("p1", Y, B, T1)],
      events: [event("e1", X, B, T1)],
    });

    expect(revisions.map((revision) => revision.headOid)).toEqual([X, B]);
    expect(degradations).toHaveLength(1);
    expect(degradations[0].path).toEqual(["revisions", 1]);
    expect(degradations[0].message).toContain("predecessor");
    expect(revisions[1].previousOid).toBe(X);
  });

  test("degrade when the timestamps are more than a minute apart", () => {
    const { degradations } = chain({
      commits: [B],
      pushes: [push("p1", X, B, "2025-01-01T01:05:00Z")],
      events: [event("e1", X, B, T1)],
    });

    expect(degradations).toHaveLength(1);
    expect(degradations[0].path).toEqual(["revisions", 1]);
    expect(degradations[0].message).toContain("60 seconds");
  });

  test("make a revision of their own when no push record covers the head", () => {
    const { revisions } = chain({ commits: [B], events: [event("e1", X, B, T1)] });

    expect(revisions[1]).toMatchObject({ headOid: B, origin: "force-push", pushId: null, eventId: "e1" });
  });

  test("degrade and add no revision for an after commit that is gone", () => {
    const { revisions, degradations } = chain({ commits: [A], events: [event("e1", X, null, T1)] });

    // The before commit was still a state of the branch, so it is inferred as usual.
    expect(revisions.map((revision) => [revision.headOid, revision.origin])).toEqual([
      [X, "inferred"],
      [A, "inferred"],
    ]);
    expect(degradations).toEqual([{ path: ["revisions"], message: expect.stringContaining("e1") }]);
  });

  test("keep an unknown predecessor as null when the before commit is gone", () => {
    const { revisions } = chain({ commits: [A], events: [event("e1", null, A, T1)] });

    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ headOid: A, previousOid: null, origin: "force-push" });
  });
});

describe("inferred revisions", () => {
  test("stand in for the opening head that only the first event names", () => {
    const result = chain({ commits: [B], events: [event("e1", X, B, T1)] });

    expect(result.revisions[0]).toEqual({
      headOid: X,
      previousOid: null,
      pushedAt: null,
      pusher: null,
      origin: "inferred",
      pushId: null,
      eventId: null,
      commits: [],
    });
    expect(result.byTime(T0)).toEqual({ revision: 0, by: "timestamp" });
    expect(result.byTime(T2)).toEqual({ revision: 1, by: "timestamp" });
  });

  test("sit right before their successor across a gap in the chain", () => {
    const result = chain({ commits: [D], events: [event("e1", A, B, T1), event("e2", C, D, T3)] });

    expect(result.revisions.map((revision) => revision.headOid)).toEqual([A, B, C, D]);
    expect(result.revisions.map((revision) => revision.origin)).toEqual([
      "inferred",
      "force-push",
      "inferred",
      "force-push",
    ]);

    // Between the two known pushes the inferred head has no time to claim, so the last known
    // revision keeps the interval.
    expect(result.byTime(T2)).toEqual({ revision: 1, by: "timestamp" });
  });

  test("hold every commit when nothing recorded a push", () => {
    const result = chain({ commits: [A, B] });

    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({ headOid: B, origin: "inferred", pushedAt: null, commits: [A, B] });
    expect(result.byCommit(A)).toEqual({ revision: 0, by: "commit" });
    expect(result.byTime(T0)).toEqual({ revision: 0, by: "timestamp" });
  });

  test("exist even for a pull request with no commits", () => {
    const result = chain({ commits: [], headRefOid: A });

    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0].headOid).toBe(A);
  });

  test("come from a push predecessor only when it survives on the branch", () => {
    const surviving = chain({ commits: [A, B], pushes: [push("p1", A, B, T1)] });
    expect(surviving.revisions.map((revision) => [revision.headOid, revision.origin, revision.commits])).toEqual([
      [A, "inferred", [A]],
      [B, "push", [B]],
    ]);

    const unknown = chain({ commits: [A, B], pushes: [push("p1", X, B, T1)] });
    expect(unknown.revisions).toHaveLength(1);
    expect(unknown.revisions[0]).toMatchObject({ headOid: B, previousOid: X, commits: [A, B] });
  });

  test("take the last surviving commit as head when headRefOid is stale", () => {
    const result = chain({ commits: [A, B], headRefOid: C, pushes: [push("p1", ZERO_OID, A, T0)] });

    expect(result.revisions.map((revision) => revision.headOid)).toEqual([A, B]);
    expect(result.revisions[1].origin).toBe("inferred");
    expect(result.degradations).toEqual([{ path: ["revisions"], message: expect.stringContaining("stale") }]);
  });
});

describe("ordering", () => {
  test("follows the chain links even when a suite timestamp lags", () => {
    const { revisions, degradations } = chain({
      commits: [A, B, C],
      pushes: [push("p1", ZERO_OID, A, T0), push("p2", A, B, T2), push("p3", B, C, T1)],
    });

    expect(revisions.map((revision) => revision.headOid)).toEqual([A, B, C]);
    expect(degradations).toEqual([{ path: ["revisions", 2], message: expect.stringContaining("follows") }]);
  });

  test("gives a head pushed away and back two revisions and picks between them by time", () => {
    const result = chain({ commits: [A], events: [event("e1", A, B, T1), event("e2", B, A, T2)] });

    expect(result.revisions.map((revision) => [revision.headOid, revision.origin])).toEqual([
      [A, "inferred"],
      [B, "force-push"],
      [A, "force-push"],
    ]);
    expect(result.revisions[0].commits).toEqual([A]);
    expect(result.revisions[2].commits).toEqual([]);

    expect(result.byCommit(A)).toEqual({ revision: 0, by: "commit" });
    expect(result.byCommit(A, T0)).toEqual({ revision: 0, by: "commit" });
    expect(result.byCommit(A, T3)).toEqual({ revision: 2, by: "commit" });
    expect(result.byCommit(B, T3)).toEqual({ revision: 1, by: "commit" });
  });
});

describe("anchoring", () => {
  const result = chain({
    commits: [A, B, C],
    pushes: [push("p1", ZERO_OID, A, T1), push("p2", A, C, T3)],
  });

  test("by commit reaches a head, a surviving commit below a tip, and nothing else", () => {
    expect(result.byCommit(A)).toEqual({ revision: 0, by: "commit" });
    expect(result.byCommit(B)).toEqual({ revision: 1, by: "commit" });
    expect(result.byCommit(X)).toBeUndefined();
  });

  test("by time takes the revision that was head at that moment", () => {
    expect(result.byTime(T0)).toEqual({ revision: 0, by: "timestamp" });
    expect(result.byTime(T1)).toEqual({ revision: 0, by: "timestamp" });
    expect(result.byTime(T2)).toEqual({ revision: 0, by: "timestamp" });
    expect(result.byTime(T3)).toEqual({ revision: 1, by: "timestamp" });
    expect(result.byTime(null)).toEqual({ revision: 1, by: "fallback" });
  });

  test("anchor prefers the commit, then the time, then the newest revision", () => {
    expect(result.anchor(B, T3)).toEqual({ revision: 1, by: "commit" });
    expect(result.anchor(X, T2)).toEqual({ revision: 0, by: "timestamp" });
    expect(result.anchor(null, T3)).toEqual({ revision: 1, by: "timestamp" });
    expect(result.anchor(X, null)).toEqual({ revision: 1, by: "fallback" });
  });

  test("resolved dropped heads own themselves", () => {
    const { revisions } = chain({
      commits: [B],
      events: [event("e1", X, B, T1)],
      resolved: new Set([X]),
    });

    expect(revisions[0].commits).toEqual([X]);
  });
});

describe("droppedHeadOids", () => {
  test("lists what push records and events name, minus the branch, sorted", () => {
    const oids = droppedHeadOids({
      commits: [A, B],
      pushes: [
        { nextSha: B, commitOid: B },
        { nextSha: Y, commitOid: B },
        { nextSha: D, commitOid: D },
      ],
      events: [
        { beforeOid: X, afterOid: C },
        { beforeOid: null, afterOid: A },
        { beforeOid: C, afterOid: null },
      ],
    });

    expect(oids).toEqual([C, D, X]);
  });
});
