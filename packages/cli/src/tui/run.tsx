// Owns the terminal. The app itself is a plain component so a test can mount it without one.

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { PullRequest } from "@prowling/core";

import { App } from "./app";
import { ensureTerminal } from "./terminal";

// Resolves when the user quits, which is what lets the caller keep returning an exit code.
export async function runTui(pullRequest: PullRequest): Promise<number> {
  // The entry point checks this before it loads this module. Repeated here because a terminal is
  // this function's precondition, not its caller's habit.
  ensureTerminal();

  // Ctrl-C is handled in the key map instead. Exiting from under the renderer would skip both the
  // promise below and the terminal restore.
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);

  try {
    return await new Promise<number>((resolve) => {
      root.render(<App pullRequest={pullRequest} onQuit={resolve} />);
    });
  } finally {
    root.unmount();
    renderer.destroy();
  }
}
