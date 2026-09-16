// Colors, glyphs, and the column widths the header lines up on.

import { type CheckRow, isFailingConclusion, type TimelineEntry } from "@prowling/core";
import { createContext, useContext } from "react";

// Field labels sit in their own column, so the check rows start where the proposal's sketch puts
// them: under the value, not under the label.
export const LABEL_WIDTH = 9;
export const RESULT_WIDTH = 19;
export const NAME_WIDTH_CAP = 44;

// The rows a region's own border takes, top and bottom.
export const BORDER = 2;

// A revision's items sit under its header, and a failing check sits under the line that counted it.
export const ENTRY_INDENT = 2;
export const NESTED_INDENT = 6;

export const OPEN = "▾";
export const CLOSED = "▸";

// What a color means, not what it is. The rules below name a role, and the component drawing the
// row resolves it against whichever palette the terminal called for.
//
// That split is what lets one set of rules serve both backgrounds. A hex chosen for a dark terminal
// is unreadable on a light one, and the rule about which check is "bad" does not change either way.
export type Role = "text" | "dim" | "accent" | "ok" | "bad" | "warn";

export type Palette = Record<Role, string>;

export const DARK: Palette = {
  text: "#c9d1d9",
  dim: "#6e7681",
  accent: "#58a6ff",
  ok: "#3fb950",
  bad: "#f85149",
  warn: "#d29922",
};

// Every role here clears roughly 4.5:1 against white. The dark foregrounds do not come close on that
// background: #c9d1d9 lands near 1.3:1, which is why the title and the description read as blank.
export const LIGHT: Palette = {
  text: "#1f2328",
  dim: "#59636e",
  accent: "#0969da",
  ok: "#1a7f37",
  bad: "#d1242f",
  warn: "#9a6700",
};

// Dark is the default, which is what a terminal that answers no background query gets.
export const PaletteContext = createContext<Palette>(DARK);

export function usePalette(): Palette {
  return useContext(PaletteContext);
}

export function glyphFor(row: CheckRow): string {
  switch (row.kind) {
    case "pending":
      return "●";
    case "missing":
      return "!";
    default:
      return conclusionGlyph(row);
  }
}

export function colorFor(row: CheckRow): Role {
  switch (row.kind) {
    case "pending":
      return "accent";
    case "missing":
      return "warn";
    case "stale":
      return failed(row) ? "bad" : "dim";
    default:
      return conclusionColor(row);
  }
}

// What the row says in its result column. A missing check has no result, so it says why it is
// listed at all.
export function resultFor(row: CheckRow): string {
  if (row.kind === "missing") {
    return "REQUIRED, never run";
  }

  return row.conclusion ?? row.status ?? "UNKNOWN";
}

export function staleSuffix(row: CheckRow): string {
  if (row.staleOn === null) {
    return "";
  }

  return row.staleOn.back === null ? row.staleOn.oid : `${row.staleOn.oid}, ${row.staleOn.back} back`;
}

// Truncates to fit, marking the cut so a name that lost its tail does not read as the whole name.
export function clamp(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

// A filled mark is feedback on the code, a hollow one is everything else. The kind reads from the
// shape, and the color says what state it is in.
export function entryGlyph(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "review":
      return "●";
    case "thread":
      return "◆";
    case "comment":
      return "◇";
  }
}

export function entryColor(entry: TimelineEntry): Role {
  switch (entry.kind) {
    case "review":
      return reviewColor(entry.state);
    case "thread":
      return entry.isResolved ? "dim" : "bad";
    case "comment":
      return "dim";
  }
}

function reviewColor(state: string): Role {
  switch (state) {
    case "APPROVED":
      return "ok";
    case "CHANGES_REQUESTED":
      return "bad";
    case "COMMENTED":
      return "text";
    default:
      return "dim";
  }
}

function conclusionGlyph(row: CheckRow): string {
  switch (row.conclusion) {
    case "SUCCESS":
      return "✓";
    case "SKIPPED":
      return "○";
    case "NEUTRAL":
    case "CANCELLED":
      return "·";
    case null:
      return "●";
    default:
      return "⚠";
  }
}

function conclusionColor(row: CheckRow): Role {
  switch (row.conclusion) {
    case "SUCCESS":
      return "ok";
    case "SKIPPED":
    case "NEUTRAL":
    case "CANCELLED":
      return "dim";
    case null:
      return "accent";
    default:
      return "bad";
  }
}

function failed(row: CheckRow): boolean {
  return isFailingConclusion(row.conclusion);
}
