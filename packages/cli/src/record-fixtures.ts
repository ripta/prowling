import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  createTransport,
  fetchPullRequest,
  formatPullRequestRef,
  parsePullRequestRef,
  withRecording,
} from "@prowling/core";

import { resolveToken } from "./auth";
import { createFileRecorder } from "./recorder";

// Re-records every fixture in the manifest. A recording is keyed by a hash of its request body, and
// the body carries the query document, so any edit to a document orphans every recording. This puts
// them all back in one command. Each fixture directory is emptied first so orphaned keys do not
// accumulate next to the fresh ones.

export const FIXTURES_DIR = join(import.meta.dir, "..", "..", "core", "fixtures", "pulls");

export type ManifestEntry = {
  name: string;
  ref: string;
};

export async function readManifest(): Promise<ManifestEntry[]> {
  return (await Bun.file(join(FIXTURES_DIR, "manifest.json")).json()) as ManifestEntry[];
}

async function main(): Promise<void> {
  const token = await resolveToken();

  for (const entry of await readManifest()) {
    const ref = parsePullRequestRef(entry.ref);
    const dir = join(FIXTURES_DIR, entry.name);

    await rm(dir, { recursive: true, force: true });

    const transport = withRecording(createTransport(token), createFileRecorder(dir));
    await fetchPullRequest(transport, ref);

    const files = await readdir(dir);
    console.log(`${formatPullRequestRef(ref)}: ${files.length} recordings in ${entry.name}/`);
  }
}

if (import.meta.main) {
  await main();
}
