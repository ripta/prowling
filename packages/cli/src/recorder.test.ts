import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Recording } from "@prowling/core";

import { createFileRecorder } from "./recorder";

const recording: Recording = {
  request: {
    method: "GET",
    url: "https://api.github.com/user",
    headers: { accept: "application/vnd.github+json" },
    body: null,
  },
  response: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"login":"octocat"}',
  },
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prowling-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createFileRecorder", () => {
  test("round-trips a recording as one file per key, creating the directory", async () => {
    const recorder = createFileRecorder(join(dir, "recordings"));

    await recorder.put("abc123", recording);
    await recorder.put("def456", recording);

    const files = await readdir(join(dir, "recordings"));
    expect(files.sort()).toEqual(["abc123.json", "def456.json"]);
    expect(await recorder.get("abc123")).toEqual(recording);
  });

  test("returns undefined for an unknown key", async () => {
    const recorder = createFileRecorder(dir);

    expect(await recorder.get("missing")).toBeUndefined();
  });
});
