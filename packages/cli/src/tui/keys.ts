// What a key press means to the app.
//
// A scrollbox handles its own scrolling once focused: arrows, page up and down, home and end. So
// the rule here is that an unclaimed key returns undefined and reaches the focused region
// untouched. Claiming a key the scrollbox needs would take scrolling away from it.

export type Action = "quit" | "toggle-description" | "focus-next" | "focus-prev" | "activate";

// The shape of a key press, narrowed to what the mapping reads. KeyEvent satisfies it, so this
// module imports nothing from the terminal and its test needs no renderer.
export type Key = {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
};

export const HINTS: readonly { keys: string; label: string }[] = [
  { keys: "d", label: "description" },
  { keys: "tab", label: "focus" },
  { keys: "↑↓", label: "scroll" },
  { keys: "q", label: "quit" },
];

export function resolveAction(key: Key): Action | undefined {
  if (key.ctrl) {
    return key.name === "c" ? "quit" : undefined;
  }

  switch (key.name) {
    case "q":
      return "quit";
    case "d":
      return "toggle-description";
    // The parser reports shift-tab as tab with the modifier set, never as its own key name.
    case "tab":
      return key.shift === true ? "focus-prev" : "focus-next";
    case "return":
    case "enter":
    case "space":
      return "activate";
    default:
      return undefined;
  }
}
