// Whether there is a terminal to draw on, kept apart from the renderer. The entry point checks
// this before loading OpenTUI, so the one failure that means "no terminal" never pays for one.

export class NotATerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotATerminalError";
  }
}

export function ensureTerminal(): void {
  if (process.stdout.isTTY !== true) {
    throw new NotATerminalError("prowling needs a terminal. Use --json when output is redirected.");
  }
}
