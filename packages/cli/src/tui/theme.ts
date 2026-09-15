// Colors, glyphs, and the column widths the header lines up on.

import type { CheckRow } from "@prowling/core";

// Field labels sit in their own column, so the check rows start where the proposal's sketch puts
// them: under the value, not under the label.
export const LABEL_WIDTH = 9;
export const RESULT_WIDTH = 19;
export const NAME_WIDTH_CAP = 44;

export const COLORS = {
  text: "#c9d1d9",
  dim: "#6e7681",
  accent: "#58a6ff",
  ok: "#3fb950",
  bad: "#f85149",
  warn: "#d29922",
} as const;

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

export function colorFor(row: CheckRow): string {
  switch (row.kind) {
    case "pending":
      return COLORS.accent;
    case "missing":
      return COLORS.warn;
    case "stale":
      return failed(row) ? COLORS.bad : COLORS.dim;
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

function conclusionColor(row: CheckRow): string {
  switch (row.conclusion) {
    case "SUCCESS":
      return COLORS.ok;
    case "SKIPPED":
    case "NEUTRAL":
    case "CANCELLED":
      return COLORS.dim;
    case null:
      return COLORS.accent;
    default:
      return COLORS.bad;
  }
}

function failed(row: CheckRow): boolean {
  return row.conclusion !== null && !["SUCCESS", "SKIPPED", "NEUTRAL", "CANCELLED"].includes(row.conclusion);
}
