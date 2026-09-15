import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import manifest from "../fixtures/pulls/manifest.json";

import { parsePullRequestRef } from "./github/ref";
import type { Anchor, PullRequest, RevisionOrigin } from "./model";
import { fetchPullRequest } from "./pull-request";
import { ZERO_OID } from "./revisions";
import { type Recorder, type Recording, withReplay } from "./transport";

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures", "pulls");

// Fixtures are read-only. A put would mean a request the recording does not cover, which is the
// situation replay exists to catch.
function fixtureRecorder(dir: string): Recorder {
  return {
    async get(key) {
      const file = Bun.file(join(dir, `${key}.json`));
      return (await file.exists()) ? ((await file.json()) as Recording) : undefined;
    },
    async put() {
      throw new Error("fixtures are read-only");
    },
  };
}

const loaded = new Map<string, Promise<PullRequest>>();

function fixture(name: string): Promise<PullRequest> {
  let pending = loaded.get(name);

  if (pending === undefined) {
    const entry = manifest.find((candidate) => candidate.name === name);
    if (entry === undefined) {
      throw new Error(`no manifest entry named ${name}`);
    }

    const transport = withReplay(fixtureRecorder(join(FIXTURES_DIR, name)));
    pending = fetchPullRequest(transport, parsePullRequestRef(entry.ref));
    loaded.set(name, pending);
  }

  return pending;
}

type Identified = { id: string };

function everyNode(pullRequest: PullRequest): Identified[] {
  const nodes: Identified[] = [pullRequest, ...pullRequest.reviewRequests, ...pullRequest.timeline];

  if (pullRequest.viewer.latestReview !== null) {
    nodes.push(pullRequest.viewer.latestReview);
  }

  for (const thread of pullRequest.threads) {
    nodes.push(thread, ...thread.comments);
  }

  for (const commit of [...pullRequest.commits, ...pullRequest.droppedCommits]) {
    nodes.push(commit);

    for (const suite of commit.checkSuites) {
      nodes.push(suite, ...suite.checks);

      if (suite.push !== null) {
        nodes.push(suite.push);
      }

      if (suite.workflowRun !== null) {
        nodes.push(suite.workflowRun);
      }
    }
  }

  return nodes;
}

function checks(pullRequest: PullRequest) {
  return pullRequest.commits.flatMap((commit) => commit.checkSuites).flatMap((suite) => suite.checks);
}

function droppedChecks(pullRequest: PullRequest) {
  return pullRequest.droppedCommits.flatMap((commit) => commit.checkSuites).flatMap((suite) => suite.checks);
}

function anchoredBy(items: { anchor: Anchor }[], by: Anchor["by"]) {
  return items.filter((item) => item.anchor.by === by);
}

function heads(pullRequest: PullRequest): string[] {
  return pullRequest.revisions.map((revision) => revision.headOid.slice(0, 7));
}

function pushPairs(pullRequest: PullRequest): string[] {
  const pairs = new Map<string, string>();

  for (const suite of pullRequest.commits.flatMap((commit) => commit.checkSuites)) {
    if (suite.push !== null) {
      pairs.set(suite.push.id, `${suite.push.previousSha?.slice(0, 7)}->${suite.push.nextSha?.slice(0, 7)}`);
    }
  }

  return [...pairs.values()];
}

describe("every fixture", () => {
  for (const entry of manifest) {
    test(`${entry.ref} replays cleanly and every node carries a current-format id`, async () => {
      const pullRequest = await fixture(entry.name);

      expect(pullRequest.degradations).toEqual([]);
      expect(pullRequest.viewer.login).toBe("ripta");

      const nodes = everyNode(pullRequest);
      expect(nodes.length).toBeGreaterThan(0);

      for (const node of nodes) {
        expect(node.id).toMatch(/^[A-Za-z]+_[A-Za-z0-9_-]+$/);
      }
    });
  }
});

describe("cli/cli#14429, ordinary pushes", () => {
  test("carries the pull request state the header needs", async () => {
    const pullRequest = await fixture("cli-cli-14429");

    expect(pullRequest.number).toBe(14429);
    expect(pullRequest.state).toBe("MERGED");
    expect(pullRequest.isCrossRepository).toBe(false);
    expect(pullRequest.headRepository).toBe("cli/cli");
    expect(pullRequest.author).toEqual({ login: "williammartin", kind: "User" });
    expect(pullRequest.reviewDecision).toBe("APPROVED");
    expect(pullRequest.reviewRequests).toHaveLength(1);
    expect(pullRequest.viewer).toEqual({ login: "ripta", didAuthor: false, latestReview: null });
  });

  test("keeps the timeline in API order with commits and reviews", async () => {
    const pullRequest = await fixture("cli-cli-14429");

    expect(pullRequest.timeline.map((item) => item.kind)).toEqual([
      "commit",
      "review",
      "commit",
      "commit",
      "review",
      "commit",
    ]);
    expect(pullRequest.threads).toEqual([]);
  });

  test("reconstructs the four push records ADR-01 measured", async () => {
    const pullRequest = await fixture("cli-cli-14429");

    expect(pullRequest.commits).toHaveLength(4);
    expect(pushPairs(pullRequest)).toEqual([
      "0000000->98cb293",
      "98cb293->26fc6d4",
      "26fc6d4->dc6221e",
      "dc6221e->a9d9d84",
    ]);
  });

  test("chains one push revision per commit and anchors every item by commit", async () => {
    const pullRequest = await fixture("cli-cli-14429");

    expect(heads(pullRequest)).toEqual(["98cb293", "26fc6d4", "dc6221e", "a9d9d84"]);
    expect(pullRequest.revisions.every((revision) => revision.origin === "push")).toBe(true);
    expect(pullRequest.revisions.every((revision) => revision.pushId !== null && revision.eventId === null)).toBe(true);
    expect(pullRequest.revisions[0].previousOid).toBe(ZERO_OID);
    expect(pullRequest.revisions.map((revision) => revision.commits)).toEqual(
      pullRequest.commits.map((commit) => [commit.oid]),
    );
    expect(pullRequest.droppedCommits).toEqual([]);

    expect(pullRequest.timeline.map((item) => item.anchor)).toEqual([
      { revision: 0, by: "commit" },
      { revision: 0, by: "commit" },
      { revision: 1, by: "commit" },
      { revision: 2, by: "commit" },
      { revision: 2, by: "commit" },
      { revision: 3, by: "commit" },
    ]);
  });

  test("normalizes Actions runs with steps and generic runs with summary text", async () => {
    const pullRequest = await fixture("cli-cli-14429");
    const all = checks(pullRequest);

    expect(all).toHaveLength(94);

    const actions = all.filter((check) => check.provider === "actions");
    const generic = all.filter((check) => check.provider === "generic");
    expect(actions).toHaveLength(90);
    expect(generic).toHaveLength(4);

    const withSteps = all.filter((check) => check.steps.length > 0);
    expect(withSteps).toHaveLength(42);
    expect(withSteps.every((check) => check.provider === "actions")).toBe(true);

    expect(generic.every((check) => check.steps.length === 0)).toBe(true);
    expect(generic.every((check) => check.summaryText !== null)).toBe(true);

    expect(all.filter((check) => check.isRequired)).toHaveLength(12);

    const step = withSteps[0].steps[0];
    expect(step.number).toBe(1);
    expect(step.status).toBe("COMPLETED");
    expect(typeof step.durationSeconds).toBe("number");
  });
});

describe("cli/cli#14354, force-pushes", () => {
  test("keeps every force-push event and the surviving push records", async () => {
    const pullRequest = await fixture("cli-cli-14354");

    const forcePushes = pullRequest.timeline.filter((item) => item.kind === "force-push");
    expect(forcePushes).toHaveLength(17);
    expect(pullRequest.timeline).toHaveLength(22);

    const last = forcePushes[forcePushes.length - 1];
    expect(last.kind === "force-push" && last.beforeOid?.slice(0, 7)).toBe("f6e0d8f");
    expect(last.kind === "force-push" && last.afterOid?.slice(0, 7)).toBe("6dc60bf");

    expect(pullRequest.commits).toHaveLength(2);
    expect(pushPairs(pullRequest)).toEqual(["f6e0d8f->6dc60bf", "6dc60bf->7901e7e"]);
  });

  test("keeps review threads as threads with resolution state and anchored comments", async () => {
    const pullRequest = await fixture("cli-cli-14354");

    expect(pullRequest.threads).toHaveLength(6);
    expect(pullRequest.threads.filter((thread) => thread.isResolved)).toHaveLength(5);
    expect(pullRequest.threads.filter((thread) => thread.isOutdated)).toHaveLength(5);

    const comments = pullRequest.threads.flatMap((thread) => thread.comments);
    expect(comments).toHaveLength(10);
    expect(comments.every((comment) => comment.originalCommitOid !== null)).toBe(true);
    expect(comments.every((comment) => comment.reviewId !== null)).toBe(true);
    expect(comments.every((comment) => comment.diffHunk.length > 0)).toBe(true);

    const resolved = pullRequest.threads.find((thread) => thread.isResolved);
    expect(resolved?.resolvedBy?.login).toBeString();
  });

  test("resolves every dropped head with its suites and cross-checks each force-push cleanly", async () => {
    const pullRequest = await fixture("cli-cli-14354");

    expect(pullRequest.revisions).toHaveLength(19);
    expect(pullRequest.revisions.map((revision) => revision.origin)).toEqual([
      "push",
      ...Array<RevisionOrigin>(17).fill("force-push"),
      "push",
    ]);

    // The opening push surfaces through the dropped commit's own suites, so the first revision is
    // a real push rather than an inferred head.
    expect(heads(pullRequest)[0]).toBe("a119f60");
    expect(pullRequest.revisions[0]).toMatchObject({ previousOid: ZERO_OID, pushedAt: "2026-09-04T15:46:57Z" });
    expect(pullRequest.revisions[18].headOid).toBe(pullRequest.headRefOid);

    const forced = pullRequest.revisions.slice(1, 18);
    expect(forced.every((revision) => revision.pushId !== null && revision.eventId !== null)).toBe(true);
    expect(pullRequest.degradations).toEqual([]);

    expect(pullRequest.droppedCommits).toHaveLength(17);
    expect(pullRequest.droppedCommits.map((commit) => commit.oid)).toEqual(
      pullRequest.revisions.slice(0, 17).map((revision) => revision.headOid),
    );
    expect(pullRequest.droppedCommits.every((commit) => commit.checkSuites.length > 0)).toBe(true);
    expect(droppedChecks(pullRequest)).toHaveLength(162);
    expect(droppedChecks(pullRequest).filter((check) => check.steps.length > 0)).toHaveLength(130);
  });

  test("anchors review comments by original commit, two of them onto a dropped revision", async () => {
    const pullRequest = await fixture("cli-cli-14354");

    const comments = pullRequest.threads.flatMap((thread) => thread.comments);
    expect(anchoredBy(comments, "commit")).toHaveLength(10);
    expect(comments.filter((comment) => comment.anchor.revision === 1)).toHaveLength(2);
    expect(comments.filter((comment) => comment.anchor.revision === 17)).toHaveLength(8);

    const forcePushes = pullRequest.timeline.filter((item) => item.kind === "force-push");
    expect(forcePushes.map((item) => item.anchor.revision)).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));

    const commits = pullRequest.timeline.filter((item) => item.kind === "commit");
    expect(commits.map((item) => item.anchor)).toEqual([
      { revision: 17, by: "commit" },
      { revision: 18, by: "commit" },
    ]);
  });
});

describe("cli/cli#14349, one force-push", () => {
  test("agrees between the force-push event and the push record", async () => {
    const pullRequest = await fixture("cli-cli-14349");

    expect(pullRequest.state).toBe("OPEN");
    expect(pullRequest.mergeable).toBe("MERGEABLE");
    expect(pullRequest.reviewDecision).toBe("REVIEW_REQUIRED");

    expect(pullRequest.timeline.map((item) => item.kind)).toEqual(["commit", "force-push"]);

    const forcePush = pullRequest.timeline[1];
    expect(forcePush.kind === "force-push" && forcePush.beforeOid?.slice(0, 7)).toBe("4e10fe3");
    expect(forcePush.kind === "force-push" && forcePush.afterOid?.slice(0, 7)).toBe("091f872");

    expect(pullRequest.commits).toHaveLength(1);
    expect(pushPairs(pullRequest)).toEqual(["4e10fe3->091f872"]);

    const all = checks(pullRequest);
    expect(all).toHaveLength(8);
    expect(all.every((check) => check.provider === "actions" && check.steps.length > 0)).toBe(true);
  });

  test("chains the opening push, resolved from the dropped head, into the force-push", async () => {
    const pullRequest = await fixture("cli-cli-14349");

    expect(heads(pullRequest)).toEqual(["4e10fe3", "091f872"]);
    expect(pullRequest.revisions[0]).toMatchObject({
      origin: "push",
      previousOid: ZERO_OID,
      pushedAt: "2026-09-04T15:10:31Z",
      eventId: null,
    });
    expect(pullRequest.revisions[1]).toMatchObject({ origin: "force-push", pushedAt: "2026-09-04T15:17:40Z" });
    expect(pullRequest.revisions[1].pushId).not.toBeNull();
    expect(pullRequest.revisions[1].eventId).not.toBeNull();
    expect(pullRequest.degradations).toEqual([]);

    expect(pullRequest.droppedCommits).toHaveLength(1);
    expect(pullRequest.droppedCommits[0].checkSuites).toHaveLength(5);
    expect(droppedChecks(pullRequest)).toHaveLength(15);
  });
});

describe("rust-lang/rust#137944, fork", () => {
  test("pages timeline items and threads to the end", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");

    expect(pullRequest.isCrossRepository).toBe(true);
    expect(pullRequest.headRepository).toBe("davidtwco/rust");

    // The API repeated two commit items across the page boundary at 300. They are dropped, which
    // is why 28 commit items stand for 30 commits.
    expect(pullRequest.timeline).toHaveLength(328);
    expect(pullRequest.timeline.filter((item) => item.kind === "comment")).toHaveLength(210);
    expect(pullRequest.timeline.filter((item) => item.kind === "force-push")).toHaveLength(63);
    expect(pullRequest.timeline.filter((item) => item.kind === "review")).toHaveLength(27);
    expect(pullRequest.timeline.filter((item) => item.kind === "commit")).toHaveLength(28);

    expect(pullRequest.threads).toHaveLength(84);
    expect(pullRequest.threads.every((thread) => thread.isResolved)).toBe(true);
    expect(pullRequest.threads.filter((thread) => thread.isOutdated)).toHaveLength(73);
    expect(pullRequest.threads.flatMap((thread) => thread.comments)).toHaveLength(188);
  });

  test("returns no check suites for head commits on the base repository", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");

    expect(pullRequest.commits).toHaveLength(30);
    expect(pullRequest.commits.every((commit) => commit.checkSuites.length === 0)).toBe(true);
  });

  test("bounds the chain by force-push events alone, with inferred heads at the opener and both gaps", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");

    expect(pullRequest.revisions).toHaveLength(66);
    expect(pullRequest.revisions.filter((revision) => revision.origin === "force-push")).toHaveLength(63);
    expect(pullRequest.revisions.filter((revision) => revision.origin === "push")).toHaveLength(0);

    const inferred = pullRequest.revisions.filter((revision) => revision.origin === "inferred");
    expect(inferred.map((revision) => revision.headOid.slice(0, 7))).toEqual(["73f1b4f", "2537bfb", "74279fe"]);
    expect(inferred.every((revision) => revision.pushedAt === null && revision.previousOid === null)).toBe(true);
    expect(pullRequest.revisions.map((revision) => revision.origin).slice(0, 4)).toEqual([
      "inferred",
      "force-push",
      "inferred",
      "force-push",
    ]);

    // The base repository resolves the fork's dropped heads by oid, and holds no suites for them.
    expect(pullRequest.droppedCommits).toHaveLength(65);
    expect(pullRequest.droppedCommits.every((commit) => commit.checkSuites.length === 0)).toBe(true);
    expect(pullRequest.degradations).toEqual([]);
  });

  test("anchors the 27 rebased commits to the push that landed them, not where the timeline lists them", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");
    const last = pullRequest.revisions.length - 1;

    expect(pullRequest.revisions[last]).toMatchObject({
      headOid: pullRequest.headRefOid,
      pushedAt: "2025-06-17T12:16:31Z",
      origin: "force-push",
    });

    const late = pullRequest.commits.filter((commit) => commit.committedDate.startsWith("2025-06-16T23:04"));
    expect(late).toHaveLength(27);
    expect(late.every((commit) => pullRequest.revisions[last].commits.includes(commit.oid))).toBe(true);

    const misplaced = pullRequest.timeline.findIndex(
      (item) => item.kind === "force-push" && item.createdAt === "2025-06-17T07:45:09Z",
    );
    expect(pullRequest.timeline[misplaced].anchor).toEqual({ revision: last - 1, by: "commit" });

    const items = pullRequest.timeline.filter((item) => item.kind === "commit");
    expect(items).toHaveLength(28);
    expect(items.every((item) => pullRequest.timeline.indexOf(item) < misplaced)).toBe(true);
    expect(items.every((item) => item.anchor.revision === last && item.anchor.by === "commit")).toBe(true);
  });

  test("falls back to time only for items whose commit does not map", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");

    const comments = pullRequest.timeline.filter((item) => item.kind === "comment");
    expect(anchoredBy(comments, "timestamp")).toHaveLength(210);

    const reviews = pullRequest.timeline.filter((item) => item.kind === "review");
    expect(anchoredBy(reviews, "commit")).toHaveLength(27);

    // 78 review comments were left on commits that were never a head, which per-commit review
    // produces. They anchor by time.
    const reviewComments = pullRequest.threads.flatMap((thread) => thread.comments);
    expect(anchoredBy(reviewComments, "commit")).toHaveLength(110);
    expect(anchoredBy(reviewComments, "timestamp")).toHaveLength(78);
    expect(anchoredBy(reviewComments, "fallback")).toHaveLength(0);
  });
});
