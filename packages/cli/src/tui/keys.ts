// What a key press means to the app, which depends on where the focus is.
//
// A key's meaning may change with the focus, but never to a heavier action than it already carried.
// Moving around, changing what a region draws, dismissing a mode, and leaving the app are four
// separate weights, and a key belongs to one of them everywhere. That is what keeps a repeated or
// held press from reaching further than the first press did.
//
// The header and the description are scrollboxes, and a scrollbox handles its own scrolling once
// focused: arrows, page up and down, home and end. So the rule in those regions is that an unclaimed
// key returns undefined and reaches the focused region untouched. Claiming a key the scrollbox needs
// would take scrolling away from it.
//
// The timeline is not a scrollbox. It draws the window its own cursor sits in, so the movement keys
// belong to the app there, and it has nothing to hand them to otherwise.

export type Action =
  | "quit"
  | "toggle-description"
  | "cycle-checks"
  | "focus-next"
  | "focus-prev"
  | "activate"
  | "close-detail"
  | "item-next"
  | "item-prev"
  | "revision-next"
  | "revision-prev";

// Tab walks this order. Phase work that adds a region appends to it and nothing else changes.
export const REGIONS = ["header", "description", "timeline"] as const;

// The detail pane is a mode rather than a tab stop. It exists only while an item is open, so putting
// it in the tab order would cycle focus onto a region that is not on screen.
export type RegionId = (typeof REGIONS)[number] | "detail";

// The shape of a key press, narrowed to what the mapping reads. KeyEvent satisfies it, so this
// module imports nothing from the terminal and its test needs no renderer.
export type Key = {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
};

export type Hint = { keys: string; label: string };

const SHARED: readonly Hint[] = [
  { keys: "c", label: "checks" },
  { keys: "d", label: "description" },
  { keys: "tab", label: "focus" },
  { keys: "q", label: "quit" },
];

const TIMELINE: readonly Hint[] = [
  { keys: "jk", label: "move" },
  { keys: "np", label: "revision" },
  { keys: "enter", label: "open" },
];

// What the focused region does, rather than every binding the app has. A bar listing all of them
// spends the width on keys that would do nothing where the focus is.
export function hintsFor(region: RegionId): readonly Hint[] {
  if (region === "detail") {
    return [
      { keys: "esc", label: "close" },
      { keys: "↑↓", label: "scroll" },
    ];
  }

  if (region === "timeline") {
    return [...TIMELINE, ...SHARED];
  }

  return [{ keys: "↑↓", label: "scroll" }, ...SHARED];
}

export function resolveAction(key: Key, region: RegionId): Action | undefined {
  if (key.ctrl) {
    return key.name === "c" ? "quit" : undefined;
  }

  // The pane is modal, so it claims only the key that closes it and leaves the rest to its
  // scrollbox. Toggling the description underneath it, or tabbing to a region it covers, would act
  // on something the reader cannot see.
  //
  // Dismissing and leaving are different weights of action, so no key carries both. `esc` dismisses
  // and `q` leaves. Neither takes on the other's job in any region, which is what keeps a repeated
  // press from reaching further than the first one did. So `q` means nothing here, and a reader
  // leaning on it ends up with the pane closed and the app still running. Ctrl-C still leaves.
  if (region === "detail") {
    return key.name === "escape" ? "close-detail" : undefined;
  }

  switch (key.name) {
    case "q":
      return "quit";
    case "c":
      return "cycle-checks";
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
      return region === "timeline" ? timelineAction(key) : undefined;
  }
}

function timelineAction(key: Key): Action | undefined {
  switch (key.name) {
    case "down":
    case "j":
      return "item-next";
    case "up":
    case "k":
      return "item-prev";
    case "n":
      return "revision-next";
    case "p":
      return "revision-prev";
    default:
      return undefined;
  }
}
