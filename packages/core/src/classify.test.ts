import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import manifest from "../fixtures/pulls/manifest.json";

import { parsePullRequestRef } from "./github/ref";
import type { Actor, Classification, PullRequest } from "./model";
import { fetchPullRequest } from "./pull-request";
import { type Recorder, type Recording, withReplay } from "./transport";

import {
  type ClassifiedBody,
  classifiedBodies,
  classify,
  type ClassifyInput,
  RULES,
  SNIPPET_CHARS,
} from "./classify";

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures", "pulls");

const octocat: Actor = { login: "octocat", kind: "User" };
const copilot: Actor = { login: "copilot-pull-request-reviewer", kind: "Bot" };

function verdict(bodyText: string, overrides: Partial<ClassifyInput> = {}): Classification {
  return classify({ source: "comment", author: octocat, bodyText, ...overrides });
}

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

function expectations(name: string): Promise<ClassifiedBody[]> {
  return Bun.file(join(FIXTURES_DIR, `${name}.classification.json`)).json() as Promise<ClassifiedBody[]>;
}

describe("empty-body", () => {
  test("a review that decided something and said nothing is procedural", () => {
    expect(verdict("", { source: "review" })).toEqual({ kind: "procedural", rule: "empty-body" });
  });

  test("whitespace says as little as nothing", () => {
    expect(verdict("\n   \n")).toEqual({ kind: "procedural", rule: "empty-body" });
  });
});

describe("slash-command", () => {
  test("a body that is only a command is procedural", () => {
    expect(verdict("/retest")).toEqual({ kind: "procedural", rule: "slash-command" });
  });

  test("several commands are still only commands", () => {
    expect(verdict("/lgtm cancel\n/assign @octocat")).toEqual({ kind: "procedural", rule: "slash-command" });
  });

  test("a command with a point under it is the point", () => {
    expect(verdict("/retest\n\nThe flake is in the fixture loader, not the change.")).toEqual({
      kind: "technical",
      rule: null,
    });
  });
});

describe("mention-only", () => {
  test("a bare ping is procedural", () => {
    expect(verdict("@octocat")).toEqual({ kind: "procedural", rule: "mention-only" });
  });

  test("a ping with a short phrase around it is still a ping", () => {
    expect(verdict("@octocat please take a look")).toEqual({ kind: "procedural", rule: "mention-only" });
  });

  test("one word past the phrase it is allowed makes it a point", () => {
    expect(verdict("@octocat please take a closer look")).toEqual({ kind: "technical", rule: null });
  });

  // The command form that is not a slash. This is how bors and rust-timer are driven, and it is the
  // single most common procedural body across the fixtures.
  test("a command addressed to a bot by name lands here", () => {
    expect(verdict("@bors try @rust-timer queue")).toEqual({ kind: "procedural", rule: "mention-only" });
  });

  test("a mention in front of a point about the change is not a ping", () => {
    expect(verdict("@octocat this drops the lifetime bound on the trait object")).toEqual({
      kind: "technical",
      rule: null,
    });
  });

  test("a short body with nobody named in it is not a ping", () => {
    expect(verdict("ptal")).toEqual({ kind: "technical", rule: null });
  });

  // Measured on rust-lang/rust#137944, where a command opens a comment that then explains itself.
  test("a command with prose under it is the prose", () => {
    expect(verdict("@bors r+ p=5\n\nLet us see whether this helps the solver at all.")).toEqual({
      kind: "technical",
      rule: null,
    });
  });
});

describe("bot-phrasing", () => {
  test("a marker for a run that started is procedural", () => {
    expect(verdict("⌛ Testing commit c290ee6 with merge eba2d19...")).toEqual({
      kind: "procedural",
      rule: "bot-phrasing",
    });
  });

  test("a marker for a run that passed is procedural", () => {
    expect(verdict("☀️ Test successful - checks-actions")).toEqual({ kind: "procedural", rule: "bot-phrasing" });
  });

  test("a marker for a run that failed is left alone", () => {
    expect(verdict("💔 Test failed - checks-actions")).toEqual({ kind: "technical", rule: null });
  });

  test("a merge conflict is left alone", () => {
    expect(verdict("☔ The latest upstream changes made this pull request unmergeable.")).toEqual({
      kind: "technical",
      rule: null,
    });
  });

  test("a bot that marks nothing is read by its phrasing", () => {
    expect(verdict("Queued 891c5af with parent cb678b9, future comparison URL.")).toEqual({
      kind: "procedural",
      rule: "bot-phrasing",
    });
  });
});

describe("review-comment", () => {
  test("inline feedback is about the code", () => {
    expect(verdict("This drops the bound.", { source: "review-comment" })).toEqual({
      kind: "technical",
      rule: "review-comment",
    });
  });
});

describe("bot-author", () => {
  test("a review summary from an app is procedural", () => {
    expect(verdict("Copilot review overview", { source: "review", author: copilot })).toEqual({
      kind: "procedural",
      rule: "bot-author",
    });
  });

  test("a person saying the same thing is not", () => {
    expect(verdict("Copilot review overview", { source: "review" })).toEqual({ kind: "technical", rule: null });
  });

  test("a deleted account is not an app", () => {
    expect(verdict("Copilot review overview", { source: "review", author: null })).toEqual({
      kind: "technical",
      rule: null,
    });
  });

  test("a migrated account nobody claimed is not an app either", () => {
    const mannequin: Actor = { login: "ghost", kind: "Mannequin" };

    expect(verdict("Copilot review overview", { source: "review", author: mannequin })).toEqual({
      kind: "technical",
      rule: null,
    });
  });
});

describe("rule order", () => {
  test("an app's inline comment stays technical", () => {
    expect(verdict("🛑 Requirement: the filter is never exercised by a test.", {
      source: "review-comment",
      author: copilot,
    })).toEqual({ kind: "technical", rule: "review-comment" });
  });

  test("a ping inside a thread folds like a ping anywhere else", () => {
    expect(verdict("@octocat ptal", { source: "review-comment" })).toEqual({
      kind: "procedural",
      rule: "mention-only",
    });
  });

  test("a body no rule matched is technical, and says no rule matched", () => {
    expect(verdict("The lifetime escapes through the closure here.")).toEqual({ kind: "technical", rule: null });
  });

  test("no two rules answer to the same name", () => {
    expect(new Set(RULES.map((rule) => rule.name)).size).toBe(RULES.length);
  });
});

describe("classifiedBodies", () => {
  test("lists the timeline before the threads", async () => {
    const bodies = classifiedBodies(await fixture("cli-cli-14354"));
    const inline = bodies.findIndex((body) => body.source === "review-comment");

    expect(inline).toBeGreaterThan(0);
    expect(bodies.slice(0, inline).every((body) => body.source !== "review-comment")).toBe(true);
    expect(bodies.slice(inline).every((body) => body.source === "review-comment")).toBe(true);
  });

  test("carries one line of each body, cut to fit", async () => {
    const bodies = classifiedBodies(await fixture("rust-lang-rust-137944"));

    expect(bodies.length).toBeGreaterThan(0);

    for (const body of bodies) {
      expect(body.snippet).not.toInclude("\n");
      expect(body.snippet.length).toBeLessThanOrEqual(SNIPPET_CHARS);
    }
  });
});

describe("every fixture", () => {
  const names = new Set(RULES.map((rule) => rule.name));

  for (const entry of manifest) {
    test(`${entry.ref} classifies every body the way the checked-in expectations say`, async () => {
      const expected = await expectations(entry.name);

      expect(classifiedBodies(await fixture(entry.name))).toEqual(expected);

      for (const body of expected) {
        if (body.rule !== null) {
          expect(names).toContain(body.rule);
        }
      }
    });
  }
});
