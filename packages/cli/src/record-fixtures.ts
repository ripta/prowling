import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  createTransport,
  fetchPullRequest,
  formatPullRequestRef,
  parsePullRequestRef,
  ReplayMissError,
  type Transport,
  withRecording,
  withReplay,
} from "@prowling/core";

import { resolveToken } from "./auth";
import { createFileRecorder } from "./recorder";

// Re-records every fixture in the manifest. A recording is keyed by a hash of its request body, and
// the body carries the query document, so any edit to a document orphans every recording. This puts
// them all back in one command. Each fixture directory is emptied first so orphaned keys do not
// accumulate next to the fresh ones.
//
// With --fill, a request that already has a recording replays it, and only the misses reach the
// network. That is how a new request added to the fetch gets into the fixtures without disturbing
// what the existing recordings say, since a pull request keeps moving after it was recorded.

export const FIXTURES_DIR = join(import.meta.dir, "..", "..", "core", "fixtures", "pulls");

export type ManifestEntry = {
  name: string;
  ref: string;
};

export async function readManifest(): Promise<ManifestEntry[]> {
  return (await Bun.file(join(FIXTURES_DIR, "manifest.json")).json()) as ManifestEntry[];
}

function fillTransport(token: string, dir: string): Transport {
  const recorder = createFileRecorder(dir);
  const replay = withReplay(recorder);
  const record = withRecording(createTransport(token), recorder);

  return async (request) => {
    try {
      return await replay(request);
    } catch (error) {
      if (error instanceof ReplayMissError) {
        return record(request);
      }

      throw error;
    }
  };
}

async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { fill: { type: "boolean" } }, strict: true });
  const fill = values.fill ?? false;

  const token = await resolveToken();

  for (const entry of await readManifest()) {
    const ref = parsePullRequestRef(entry.ref);
    const dir = join(FIXTURES_DIR, entry.name);

    const before = fill ? (await readdir(dir).catch(() => [])).length : 0;

    if (!fill) {
      await rm(dir, { recursive: true, force: true });
    }

    const transport = fill
      ? fillTransport(token, dir)
      : withRecording(createTransport(token), createFileRecorder(dir));

    await fetchPullRequest(transport, ref);

    const files = await readdir(dir);
    const added = fill ? ` (${files.length - before} new)` : "";
    console.log(`${formatPullRequestRef(ref)}: ${files.length} recordings in ${entry.name}/${added}`);
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
