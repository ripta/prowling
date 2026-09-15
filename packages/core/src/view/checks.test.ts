import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import manifest from "../../fixtures/pulls/manifest.json";

import { parsePullRequestRef } from "../github/ref";
import type { CheckStatus, PullRequest } from "../model";
import { fetchPullRequest } from "../pull-request";
import { type Recorder, type Recording, withReplay } from "../transport";

import { type CheckCommit, type CheckRow, type CheckRowsInput, type CheckRun, deriveCheckRows } from "./checks";

const T0 = "2025-01-01T00:00:00Z";
const T1 = "2025-01-01T01:00:00Z";
const T2 = "2025-01-01T02:00:00Z";

// Oids are one letter repeated, so a seven-character prefix still reads as the letter.
function oid(letter: string): string {
  return letter.repeat(40);
}

function run(name: string, overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: `CR_${name}`,
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    startedAt: T0,
    completedAt: T1,
    detailsUrl: null,
    isRequired: false,
    ...overrides,
  };
}

// A run that registered and never started. Nothing to report but the name.
function never(name: string, isRequired: boolean): CheckRun {
  return run(name, { status: "QUEUED", conclusion: null, startedAt: null, completedAt: null, isRequired });
}

function commit(letter: string, ...checks: CheckRun[]): CheckCommit {
  return { oid: oid(letter), checkSuites: [{ checks }] };
}

function chain(...letters: string[]) {
  return letters.map((letter) => ({ headOid: oid(letter), commits: [oid(letter)] }));
}

function rows(partial: Partial<CheckRowsInput>): CheckRow[] {
  return deriveCheckRows({ revisions: [], commits: [], droppedCommits: [], ...partial });
}

function only(partial: Partial<CheckRowsInput>): CheckRow {
  const derived = rows(partial);

  expect(derived).toHaveLength(1);

  return derived[0];
}

describe("the six cases", () => {
  test("a completed run on the newest revision reports its conclusion", () => {
    const row = only({ revisions: chain("a", "b"), commits: [commit("b", run("lint"))] });

    expect(row.kind).toBe("current");
    expect(row.conclusion).toBe("SUCCESS");
    expect(row.staleOn).toBeNull();
    expect(row.checkId).toBe("CR_lint");
  });

  const unfinished: CheckStatus[] = ["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"];

  test.each(unfinished)("a run left %s on the newest revision is pending", (status) => {
    const row = only({
      revisions: chain("a", "b"),
      commits: [commit("b", run("integration", { status, conclusion: null, completedAt: null }))],
    });

    expect(row.kind).toBe("pending");
    expect(row.status).toBe(status);
    expect(row.conclusion).toBeNull();
  });

  test("a result on an older revision is stale, and names that revision", () => {
    const row = only({
      revisions: chain("a", "b", "c", "d"),
      commits: [commit("b", run("e2e", { conclusion: "FAILURE" })), commit("d")],
    });

    expect(row.kind).toBe("stale");
    expect(row.conclusion).toBe("FAILURE");
    expect(row.staleOn).toEqual({ revision: 1, oid: "bbbbbbb", back: 2 });
  });

  test("a required check that never started is missing", () => {
    const row = only({ revisions: chain("a", "b"), commits: [commit("a", never("codeql", true))] });

    expect(row.kind).toBe("missing");
    expect(row.isRequired).toBe(true);
    expect(row.staleOn).toBeNull();
  });

  test("an optional check that never started gets no row", () => {
    expect(rows({ revisions: chain("a", "b"), commits: [commit("a", never("codeql", false))] })).toEqual([]);
  });

  test("skipped on the newest revision is a conclusion, not a missing check", () => {
    const row = only({
      revisions: chain("a"),
      commits: [commit("a", run("deploy", { conclusion: "SKIPPED" }))],
    });

    expect(row.kind).toBe("current");
    expect(row.conclusion).toBe("SKIPPED");
  });
});

describe("picking the run a row reports", () => {
  test("a re-run in flight outranks the conclusion it is replacing", () => {
    const row = only({
      revisions: chain("a"),
      commits: [
        commit(
          "a",
          run("build", { id: "CR_old", completedAt: T2 }),
          run("build", { id: "CR_new", status: "IN_PROGRESS", conclusion: null, completedAt: null }),
        ),
      ],
    });

    expect(row.kind).toBe("pending");
    expect(row.checkId).toBe("CR_new");
  });

  test("the newest revision with a result wins a stale row", () => {
    const row = only({
      revisions: chain("a", "b", "c", "d"),
      commits: [
        commit("a", run("e2e", { id: "CR_older", conclusion: "FAILURE" })),
        commit("c", run("e2e", { id: "CR_newer" })),
      ],
    });

    expect(row.checkId).toBe("CR_newer");
    expect(row.staleOn?.back).toBe(1);
  });

  test("runs on commits a force-push dropped still report", () => {
    const row = only({
      revisions: chain("a", "b"),
      droppedCommits: [commit("a", run("lint"))],
    });

    expect(row.kind).toBe("stale");
    expect(row.staleOn).toEqual({ revision: 0, oid: "aaaaaaa", back: 1 });
  });

  test("a surviving commit holds the row against a dropped one saying the same thing", () => {
    const row = only({
      revisions: [{ headOid: oid("a"), commits: [oid("a"), oid("b")] }],
      commits: [commit("a", run("lint", { id: "CR_surviving" }))],
      droppedCommits: [commit("b", run("lint", { id: "CR_dropped" }))],
    });

    expect(row.checkId).toBe("CR_surviving");
  });

  test("a run whose commit belongs to no revision names the commit instead", () => {
    const row = only({ revisions: chain("a"), droppedCommits: [commit("z", run("lint"))] });

    expect(row.staleOn).toEqual({ revision: null, oid: "zzzzzzz", back: null });
  });

  test("a run that started on an older revision and never finished is stale with nothing to report", () => {
    const row = only({
      revisions: chain("a", "b"),
      commits: [commit("a", run("e2e", { status: "IN_PROGRESS", conclusion: null, completedAt: null }))],
    });

    expect(row.kind).toBe("stale");
    expect(row.conclusion).toBeNull();
    expect(row.status).toBe("IN_PROGRESS");
  });
});

describe("ordering", () => {
  test("leads with what needs acting on and trails with what passed", () => {
    const derived = rows({
      revisions: chain("a", "b"),
      commits: [
        commit(
          "b",
          run("passing"),
          run("skipped", { conclusion: "SKIPPED" }),
          run("cancelled", { conclusion: "CANCELLED" }),
          run("pending", { status: "IN_PROGRESS", conclusion: null, completedAt: null }),
          run("failing", { conclusion: "FAILURE" }),
        ),
        commit("a", run("stale"), never("missing", true)),
      ],
    });

    expect(derived.map((row) => row.name)).toEqual([
      "failing",
      "missing",
      "pending",
      "stale",
      "cancelled",
      "skipped",
      "passing",
    ]);
  });

  test("a stale failure still leads", () => {
    const derived = rows({
      revisions: chain("a", "b"),
      commits: [commit("b", run("lint")), commit("a", run("e2e", { conclusion: "FAILURE" }))],
    });

    expect(derived.map((row) => row.name)).toEqual(["e2e", "lint"]);
  });

  test("a required check comes before an optional one that reads the same", () => {
    const derived = rows({
      revisions: chain("a"),
      commits: [commit("a", run("zebra", { isRequired: true }), run("alpha"))],
    });

    expect(derived.map((row) => row.name)).toEqual(["zebra", "alpha"]);
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
  // Four revisions, 98cb293 through a9d9d84. Ten of the twenty-one names last ran before the head
  // moved, all of them bot workflows that run on pull_request_target rather than on every push.
  test("names the revision every stale row last ran on", async () => {
    const pullRequest = await fixture("cli-cli-14429");
    const derived = deriveCheckRows(pullRequest);
    const stale = derived.filter((row) => row.kind === "stale");

    expect(derived).toHaveLength(21);
    expect(stale).toHaveLength(10);

    for (const row of stale) {
      expect(row.staleOn?.oid).toHaveLength(7);
      expect(row.staleOn?.back).toBeGreaterThan(0);
    }

    expect(stale.find((row) => row.name === "ready-for-review")?.staleOn).toEqual({
      revision: 2,
      oid: "dc6221e",
      back: 1,
    });
    expect(stale.find((row) => row.name === "copilot-pull-request-reviewer")?.staleOn).toEqual({
      revision: 0,
      oid: "98cb293",
      back: 3,
    });
  });

  test("leads with the stale rows and trails with the passing ones", async () => {
    const pullRequest = await fixture("cli-cli-14429");
    const kinds = deriveCheckRows(pullRequest).map((row) => row.kind);

    expect(kinds.indexOf("current")).toBe(kinds.lastIndexOf("stale") + 1);
  });

  test("reports every name once, and none that never ran without being required", async () => {
    const pullRequest = await fixture("cli-cli-14429");
    const derived = deriveCheckRows(pullRequest);
    const names = derived.map((row) => row.name);

    expect(new Set(names).size).toBe(names.length);
    expect(derived.filter((row) => row.kind === "missing" && !row.isRequired)).toEqual([]);
  });

  test("a pull request with no checks derives no rows", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");

    expect(deriveCheckRows(pullRequest)).toEqual([]);
  });
});
