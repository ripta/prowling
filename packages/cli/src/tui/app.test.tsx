import { testRender } from "@opentui/react/test-utils";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { act } from "react";

import { fetchPullRequest, parsePullRequestRef, type PullRequest, withReplay } from "@prowling/core";

import { createFileRecorder } from "../recorder";
import { FIXTURES_DIR, readManifest } from "../record-fixtures";

import { App } from "./app";

const loaded = new Map<string, Promise<PullRequest>>();

function fixture(name: string): Promise<PullRequest> {
  let pending = loaded.get(name);

  if (pending === undefined) {
    pending = readManifest().then((manifest) => {
      const entry = manifest.find((candidate) => candidate.name === name);

      if (entry === undefined) {
        throw new Error(`no manifest entry named ${name}`);
      }

      return fetchPullRequest(withReplay(createFileRecorder(join(FIXTURES_DIR, name))), parsePullRequestRef(entry.ref));
    });

    loaded.set(name, pending);
  }

  return pending;
}

let destroy: (() => void) | undefined;

// Tearing the renderer down unmounts the tree, and React wants that update owned by a test.
afterEach(async () => {
  const teardown = destroy;
  destroy = undefined;

  await act(async () => {
    teardown?.();
  });
});

async function frame(pullRequest: PullRequest, collapsedRows = 8): Promise<string> {
  const setup = await testRender(<App pullRequest={pullRequest} onQuit={() => {}} collapsedRows={collapsedRows} />, {
    width: 100,
    height: 40,
  });

  destroy = () => setup.renderer.destroy();
  await setup.renderOnce();

  return setup.captureCharFrame();
}

describe("the state header", () => {
  test("shows the decision, the threads, the reviewers, and a row per check", async () => {
    const drawn = await frame(await fixture("cli-cli-14429"));

    expect(drawn).toContain("APPROVED");
    expect(drawn).toContain("@niik");
    expect(drawn).toContain("build (macos-latest)");
    expect(drawn).toContain("21  10 stale · 11 passing");
  });

  test("marks a stale check with the revision it last ran on", async () => {
    const drawn = await frame(await fixture("cli-cli-14429"));

    expect(drawn).toContain("dc6221e, 1 back");
  });

  test("says so when a pull request has no checks", async () => {
    const drawn = await frame(await fixture("rust-lang-rust-137944"));

    expect(drawn).toContain("CHANGES_REQUESTED");
    expect(drawn).toContain("CONFLICTING");
    expect(drawn).toContain("checks   none");
  });
});

describe("the description", () => {
  test("collapses to the given rows and counts what it holds back", async () => {
    const pullRequest = await fixture("cli-cli-14354");
    const drawn = await frame(pullRequest, 8);
    const total = pullRequest.bodyText.split("\n").length;

    expect(drawn).toContain("more lines, d to expand");
    expect(total).toBeGreaterThan(8);
  });

  // A line that wraps claims rows the count never budgeted for, and the rows it overflows into get
  // drawn over. The result reads as two descriptions interleaved character by character.
  test("gives every collapsed line its own row, whatever its length", async () => {
    const pullRequest = await fixture("rust-lang-rust-137944");
    const drawn = await frame(pullRequest, 8);
    const first = pullRequest.bodyText.split("\n").find((line) => line.trim() !== "") ?? "";

    expect(first.length).toBeGreaterThan(100);
    expect(drawn).toContain(first.slice(0, 60));
  });

  test("shows a placeholder rather than an empty box", async () => {
    const pullRequest = await fixture("cli-cli-14349");
    const drawn = await frame({ ...pullRequest, body: "", bodyText: "" });

    expect(drawn).toContain("no description");
  });
});
