import { join } from "node:path";

import { classifiedBodies, fetchPullRequest, parsePullRequestRef, withReplay } from "@prowling/core";

import { createFileRecorder } from "./recorder";
import { FIXTURES_DIR, readManifest } from "./record-fixtures";

// Rewrites what the classification rules say about every fixture. Each pull request replays from the
// recordings already on disk, so this makes no network call and needs no token.
//
// Tuning a rule means running this, reading the diff, and deciding whether the bodies that moved
// should have moved. The file that lands in the commit is the record of that judgement.
//
// The expectations sit beside a recording directory rather than inside it. Re-recording empties that
// directory, and would take them with it.

async function main(): Promise<void> {
  for (const entry of await readManifest()) {
    const transport = withReplay(createFileRecorder(join(FIXTURES_DIR, entry.name)));
    const pullRequest = await fetchPullRequest(transport, parsePullRequestRef(entry.ref));

    const bodies = classifiedBodies(pullRequest);
    const procedural = bodies.filter((body) => body.kind === "procedural").length;

    await Bun.write(join(FIXTURES_DIR, `${entry.name}.classification.json`), `${JSON.stringify(bodies, null, 2)}\n`);

    console.log(`${entry.ref}: ${procedural} of ${bodies.length} bodies procedural`);
  }
}

if (import.meta.main) {
  await main();
}
