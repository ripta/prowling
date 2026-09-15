// Owns the terminal. The app itself is a plain component so a test can mount it without one.

import { createCliRenderer, type ThemeMode } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { PullRequest } from "@prowling/core";

import { App } from "./app";
import { ensureTerminal } from "./terminal";
import { DARK, LIGHT, type Palette } from "./theme";

// How long to wait on the background query before drawing the first frame.
//
// The query is a round trip to the terminal, so the answer costs a frame of delay either way.
// Paying it up front beats drawing in the wrong palette and correcting it, which reads as a flash.
const THEME_QUERY_MS = 100;

// A terminal that answers nothing leaves the mode null. Dark is the better guess there, and it is
// what the app drew before the query existed.
function paletteFor(mode: ThemeMode | null): Palette {
  return mode === "light" ? LIGHT : DARK;
}

// Resolves when the user quits, which is what lets the caller keep returning an exit code.
export async function runTui(pullRequest: PullRequest): Promise<number> {
  // The entry point checks this before it loads this module. Repeated here because a terminal is
  // this function's precondition, not its caller's habit.
  ensureTerminal();

  // Ctrl-C is handled in the key map instead. Exiting from under the renderer would skip both the
  // promise below and the terminal restore.
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);

  const initial = await renderer.waitForThemeMode(THEME_QUERY_MS);

  try {
    return await new Promise<number>((resolve) => {
      const draw = (mode: ThemeMode | null) => {
        root.render(<App pullRequest={pullRequest} onQuit={resolve} palette={paletteFor(mode)} />);
      };

      // Some terminals report a theme change while the app is open, which is what a system-wide
      // light or dark switch looks like from here.
      renderer.on("theme_mode", draw);

      draw(initial);
    });
  } finally {
    root.unmount();
    renderer.destroy();
  }
}
