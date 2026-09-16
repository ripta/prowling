import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import manifest from "../../fixtures/pulls/manifest.json";

import { parsePullRequestRef } from "../github/ref";
import type {
  Actor,
  Anchor,
  Classification,
  CommentItem,
  ForcePushItem,
  PullRequest,
  Revision,
  ReviewComment,
  ReviewItem,
  ReviewThread,
} from "../model";
import { fetchPullRequest } from "../pull-request";
import { type Recorder, type Recording, withReplay } from "../transport";

import { deriveTimeline, openingRevision, type TimelineGroup, type TimelineInput } from "./timeline";

const T0 = "2025-01-01T00:00:00Z";
const T1 = "2025-01-01T01:00:00Z";
const T2 = "2025-01-01T02:00:00Z";
const T3 = "2025-01-01T03:00:00Z";

const octocat: Actor = { login: "octocat", kind: "User" };

// Grouping is what these tests are about, so every body here is one a rule left alone.
const technical: Classification = { kind: "technical", rule: null };

// Oids are one letter repeated, so a seven-character prefix still reads as the letter.
function oid(letter: string): string {
  return letter.repeat(40);
}

function chain(...letters: string[]): Revision[] {
  return letters.map((letter) => ({
    headOid: oid(letter),
    previousOid: null,
    pushedAt: T0,
    pusher: octocat,
    origin: "push",
    pushId: `push_${letter}`,
    eventId: null,
    commits: [oid(letter)],
  }));
}

function at(revision: number): Anchor {
  return { revision, by: "commit" };
}

function review(id: string, revision: number, submittedAt: string | null): ReviewItem {
  return {
    kind: "review",
    id,
    author: octocat,
    state: "CHANGES_REQUESTED",
    body: id,
    bodyText: id,
    submittedAt,
    commitOid: null,
    url: `https://example.test/${id}`,
    isMinimized: false,
    anchor: at(revision),
    classification: technical,
  };
}

function comment(id: string, revision: number, createdAt: string): CommentItem {
  return {
    kind: "comment",
    id,
    author: octocat,
    body: id,
    bodyText: id,
    createdAt,
    url: `https://example.test/${id}`,
    isMinimized: false,
    minimizedReason: null,
    anchor: { revision, by: "timestamp" },
    classification: technical,
  };
}

function forcePush(id: string, revision: number): ForcePushItem {
  return {
    kind: "force-push",
    id,
    actor: octocat,
    createdAt: T1,
    beforeOid: oid("a"),
    afterOid: oid("b"),
    anchor: at(revision),
  };
}

function reply(id: string, revision: number, createdAt: string): ReviewComment {
  return {
    id,
    author: octocat,
    body: id,
    bodyText: id,
    createdAt,
    url: `https://example.test/${id}`,
    diffHunk: "",
    path: "src/api.go",
    line: 42,
    originalLine: 42,
    outdated: false,
    commitOid: null,
    originalCommitOid: null,
    reviewId: null,
    replyToId: null,
    isMinimized: false,
    anchor: at(revision),
    classification: technical,
  };
}

function thread(id: string, isResolved: boolean, ...comments: ReviewComment[]): ReviewThread {
  return {
    id,
    path: "src/api.go",
    line: 42,
    startLine: null,
    originalLine: 42,
    originalStartLine: null,
    diffSide: "RIGHT",
    isResolved,
    isOutdated: false,
    isCollapsed: false,
    resolvedBy: null,
    comments,
  };
}

function derive(partial: Partial<TimelineInput>): TimelineGroup[] {
  return deriveTimeline({
    revisions: [],
    timeline: [],
    threads: [],
    ...partial,
  });
}

function kinds(group: TimelineGroup): string[] {
  return group.entries.map((entry) => entry.kind);
}

function ids(group: TimelineGroup): string[] {
  return group.entries.map((entry) => entry.id);
}

describe("grouping", () => {
  test("makes one group per revision, oldest first", () => {
    const groups = derive({ revisions: chain("a", "b", "c") });

    expect(groups.map((group) => group.index)).toEqual([0, 1, 2]);
    expect(groups.map((group) => group.revision.headOid)).toEqual([oid("a"), oid("b"), oid("c")]);
  });

  test("puts a review and an issue comment under the revision they anchor to", () => {
    const groups = derive({
      revisions: chain("a", "b"),
      timeline: [review("R_1", 0, T0), comment("IC_1", 1, T1)],
    });

    expect(ids(groups[0])).toEqual(["R_1"]);
    expect(ids(groups[1])).toEqual(["IC_1"]);
  });

  // The placement decision: an issue comment reads in the order it was written, among the code
  // feedback it was written between.
  test("orders a group by time, so an issue comment sits among the code feedback", () => {
    const groups = derive({
      revisions: chain("a"),
      timeline: [comment("IC_1", 0, T2), review("R_1", 0, T1)],
      threads: [thread("T_1", false, reply("PRRC_1", 0, T3))],
    });

    expect(ids(groups[0])).toEqual(["R_1", "IC_1", "T_1"]);
  });

  test("a review still being drafted sorts last rather than first", () => {
    const groups = derive({
      revisions: chain("a"),
      timeline: [review("R_pending", 0, null), comment("IC_1", 0, T1)],
    });

    expect(ids(groups[0])).toEqual(["IC_1", "R_pending"]);
  });

  test("a thread lands where it started, not where a reply fell", () => {
    const groups = derive({
      revisions: chain("a", "b"),
      threads: [thread("T_1", false, reply("PRRC_1", 0, T0), reply("PRRC_2", 1, T2))],
    });

    expect(ids(groups[0])).toEqual(["T_1"]);
    expect(ids(groups[1])).toEqual([]);
    expect(groups[0].entries[0]).toMatchObject({ kind: "thread", replies: 1, path: "src/api.go", line: 42 });
  });

  test("a force-push and a commit say nothing the group header does not", () => {
    const groups = derive({
      revisions: chain("a", "b"),
      timeline: [forcePush("HRFPE_1", 1), { kind: "commit", id: "PRC_1", oid: oid("b"), anchor: at(1) }],
    });

    expect(kinds(groups[1])).toEqual([]);
  });

  test("an item anchored past the end of the chain is dropped rather than thrown", () => {
    const groups = derive({ revisions: chain("a"), timeline: [review("R_1", 7, T0)] });

    expect(groups).toHaveLength(1);
    expect(ids(groups[0])).toEqual([]);
  });

  test("a thread the API returned empty is skipped", () => {
    const groups = derive({ revisions: chain("a"), threads: [thread("T_1", false)] });

    expect(ids(groups[0])).toEqual([]);
    expect(groups[0].unresolved).toBe(0);
  });
});

describe("expansion", () => {
  // A pull request is usually pushed once more after the last review lands, so opening on the newest
  // revision opens on a row with nothing under it.
  test("opens on the newest revision holding conversation, not the newest overall", () => {
    const groups = derive({
      revisions: chain("a", "b", "c"),
      timeline: [review("R_1", 1, T0)],
    });

    expect(groups.map((group) => group.startsExpanded)).toEqual([false, true, false]);
    expect(openingRevision(groups)).toBe(1);
  });

  test("falls back to the newest revision when no revision holds anything", () => {
    const groups = derive({ revisions: chain("a", "b", "c") });

    expect(groups.map((group) => group.startsExpanded)).toEqual([false, false, true]);
    expect(openingRevision(groups)).toBe(2);
  });

  test("a revision where an unresolved thread started starts expanded", () => {
    const groups = derive({
      revisions: chain("a", "b", "c"),
      threads: [thread("T_1", false, reply("PRRC_1", 0, T0))],
    });

    expect(groups.map((group) => group.startsExpanded)).toEqual([true, false, false]);
    expect(groups[0].unresolved).toBe(1);
  });

  // The newer comment is what keeps the opening rule off revision a, so what the assertion turns on
  // is the thread being resolved rather than it being the only conversation on the chain.
  test("a resolved thread leaves its revision collapsed", () => {
    const groups = derive({
      revisions: chain("a", "b"),
      timeline: [comment("IC_1", 1, T1)],
      threads: [thread("T_1", true, reply("PRRC_1", 0, T0))],
    });

    expect(groups[0].startsExpanded).toBe(false);
    expect(groups[0].unresolved).toBe(0);
  });

  test("a reply on a later revision does not expand it", () => {
    const groups = derive({
      revisions: chain("a", "b", "c"),
      threads: [thread("T_1", false, reply("PRRC_1", 0, T0), reply("PRRC_2", 1, T2))],
    });

    expect(groups.map((group) => group.startsExpanded)).toEqual([true, false, false]);
  });

  test("opens at the first revision when the chain is empty", () => {
    expect(openingRevision([])).toBe(0);
  });
});

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures", "pulls");

// Fixtures are read-only. A put would mean a request the recording does not cover, which is the
// situation replay exists to catch.
function fixture(name: string): Promise<PullRequest> {
  const entry = manifest.find((candidate) => candidate.name === name);

  if (entry === undefined) {
    throw new Error(`no manifest entry named ${name}`);
  }

  const dir = join(FIXTURES_DIR, name);
  const recorder: Recorder = {
    async get(key) {
      const file = Bun.file(join(dir, `${key}.json`));
      return (await file.exists()) ? ((await file.json()) as Recording) : undefined;
    },
    async put() {
      throw new Error("fixtures are read-only");
    },
  };

  return fetchPullRequest(withReplay(recorder), parsePullRequestRef(entry.ref));
}

describe("against a recorded pull request", () => {
  test("groups every review, comment, and thread onto the chain and loses none", async () => {
    const pullRequest = await fixture("cli-cli-14349");
    const groups = deriveTimeline(pullRequest);
    const placed = groups.flatMap(ids);
    const expected =
      pullRequest.timeline.filter((item) => item.kind === "review" || item.kind === "comment").length +
      pullRequest.threads.length;

    expect(groups).toHaveLength(pullRequest.revisions.length);
    expect(placed).toHaveLength(expected);
    expect(new Set(placed).size).toBe(placed.length);
  });

  // The state header is the only surface that answers a check question. This pull request carries
  // 21 of them, and none reaches the conversation.
  test("carries no check into the groups of a pull request full of them", async () => {
    const pullRequest = await fixture("cli-cli-14429");
    const groups = deriveTimeline(pullRequest);
    const placed = groups.flatMap(ids);
    const expected =
      pullRequest.timeline.filter((item) => item.kind === "review" || item.kind === "comment").length +
      pullRequest.threads.length;

    expect(placed).toHaveLength(expected);
  });

  test("expands the newest revision on a pull request with no checks at all", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");
    const groups = deriveTimeline(pullRequest);

    expect(groups.at(-1)?.entries.length).toBeGreaterThan(0);
    expect(groups.at(-1)?.startsExpanded).toBe(true);
  });

  // Seventeen of this pull request's nineteen revisions are force-pushes nobody commented on, which
  // is the ordinary shape rather than an unusual one.
  test("skips past the empty revisions a pull request ends on", async () => {
    const pullRequest = await fixture("cli-cli-14354");
    const groups = deriveTimeline(pullRequest);
    const opens = openingRevision(groups);

    expect(groups.at(-1)?.entries).toHaveLength(0);
    expect(groups.at(-1)?.startsExpanded).toBe(false);
    expect(opens).toBeLessThan(groups.length - 1);
    expect(groups[opens]?.entries.length).toBeGreaterThan(0);
    expect(groups[opens]?.startsExpanded).toBe(true);
  });

  // Neither revision here carries any conversation, so there is no better place to open than the end.
  test("opens at the newest revision when a pull request has no conversation anywhere", async () => {
    const groups = deriveTimeline(await fixture("cli-cli-14349"));

    expect(groups.flatMap(ids)).toHaveLength(0);
    expect(openingRevision(groups)).toBe(groups.length - 1);
  });
});
