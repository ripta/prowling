import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Recorder, Recording } from "@prowling/core";

// One file per key, named by the request hash. The directory is created on first write so a fresh
// --record path works without setup.
export function createFileRecorder(dir: string): Recorder {
  return {
    async get(key) {
      const file = Bun.file(join(dir, `${key}.json`));

      if (!(await file.exists())) {
        return undefined;
      }

      return (await file.json()) as Recording;
    },

    async put(key, recording) {
      await mkdir(dir, { recursive: true });
      await Bun.write(join(dir, `${key}.json`), `${JSON.stringify(recording, null, 2)}\n`);
    },
  };
}
