// The timeline region: revisions oldest first, each holding the items that targeted it.
//
// This draws a window rather than a scrollbox. The cursor owns the movement keys here, so a
// scrollbox would be scrolling itself with keys the app has already claimed, and the two positions
// would drift apart. Drawing the window the cursor sits in keeps one position to reason about.

import type { FailedRun, TimelineEntry, TimelineGroup } from "@prowling/core";
import { useRef } from "react";

import { type Cursor, EntryLine, FailureLine, ON_HEADER, RevisionLine } from "./revision";
import { usePalette } from "./theme";

// A row is one terminal row. A failing check gets one but carries no cursor: it belongs to the line
// that counted it, and stopping on it separately would say nothing new.
export type TimelineRow =
  | { kind: "revision"; key: string; at: Cursor; group: TimelineGroup; expanded: boolean }
  | { kind: "entry"; key: string; at: Cursor; entry: TimelineEntry }
  | { kind: "failure"; key: string; run: FailedRun };

// The border either side, plus the footer row.
const BOX_CHROME = 3;

// The border and the padding either side of a row.
const ROW_CHROME = 4;

export type TimelineProps = {
  rows: TimelineRow[];
  cursor: Cursor;
  focused: boolean;
  // Rows the region may take, border and footer included.
  height: number;
  width: number;
};

export function flattenRows(groups: TimelineGroup[], expanded: ReadonlySet<number>): TimelineRow[] {
  const rows: TimelineRow[] = [];

  for (const group of groups) {
    const open = expanded.has(group.index);

    rows.push({
      kind: "revision",
      key: `rev:${group.index}`,
      at: { group: group.index, entry: ON_HEADER },
      group,
      expanded: open,
    });

    if (!open) {
      continue;
    }

    group.entries.forEach((entry, index) => {
      rows.push({
        kind: "entry",
        key: `rev:${group.index}:${index}`,
        at: { group: group.index, entry: index },
        entry,
      });

      if (entry.kind === "checks") {
        for (const run of entry.failing) {
          rows.push({ kind: "failure", key: `rev:${group.index}:${index}:${run.checkId}`, run });
        }
      }
    });
  }

  return rows;
}

// Where the cursor may stop, in the order it walks them.
export function cursorsOf(rows: TimelineRow[]): Cursor[] {
  return rows.flatMap((row) => (row.kind === "failure" ? [] : [row.at]));
}

export function sameCursor(left: Cursor, right: Cursor): boolean {
  return left.group === right.group && left.entry === right.entry;
}

export function Timeline({ rows, cursor, focused, height, width }: TimelineProps) {
  const palette = usePalette();
  const visible = Math.max(1, height - BOX_CHROME);
  const rowWidth = Math.max(1, width - ROW_CHROME);
  const top = useWindowTop(indexOf(rows, cursor), rows.length, visible);
  const shown = rows.slice(top, top + visible);

  return (
    <box
      title=" timeline "
      style={{
        flexDirection: "column",
        flexShrink: 0,
        height,
        border: true,
        borderStyle: "rounded",
        borderColor: focused ? palette.accent : palette.dim,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {rows.length === 0 ? (
        <text fg={palette.dim}>no revisions</text>
      ) : (
        <box style={{ flexDirection: "column", height: shown.length }}>
          {shown.map((row) => (
            <Line key={row.key} row={row} cursor={focused ? cursor : null} width={rowWidth} />
          ))}
        </box>
      )}
      <box style={{ flexGrow: 1 }} />
      <text fg={palette.dim} wrapMode="none">
        {footerText(rows, top, visible)}
      </text>
    </box>
  );
}

function Line({ row, cursor, width }: { row: TimelineRow; cursor: Cursor | null; width: number }) {
  if (row.kind === "failure") {
    return <FailureLine run={row.run} width={width} />;
  }

  const selected = cursor !== null && sameCursor(row.at, cursor);

  if (row.kind === "revision") {
    return <RevisionLine group={row.group} expanded={row.expanded} selected={selected} width={width} />;
  }

  return <EntryLine entry={row.entry} selected={selected} width={width} />;
}

// The scroll position follows the cursor, so it is derived rather than held as state. State would
// render the region a second time on every key press, and nothing but the cursor can move it.
//
// The first frame opens at the end of the list. Revisions run oldest first, so the newest one and
// the items it holds are the rows worth showing, and it is where the cursor starts.
function useWindowTop(index: number, total: number, visible: number): number {
  const held = useRef<number | null>(null);
  const bottom = Math.max(0, total - visible);
  let top = Math.min(held.current ?? bottom, bottom);

  if (index < top) {
    top = index;
  }

  if (index >= top + visible) {
    top = index - visible + 1;
  }

  held.current = top;

  return top;
}

function indexOf(rows: TimelineRow[], cursor: Cursor): number {
  const found = rows.findIndex((row) => row.kind !== "failure" && sameCursor(row.at, cursor));

  return found === -1 ? 0 : found;
}

// What the region holds, and how much of it is off screen either way. A revision scrolled past is
// otherwise indistinguishable from one that does not exist.
function footerText(rows: TimelineRow[], top: number, visible: number): string {
  const revisions = rows.filter((row) => row.kind === "revision").length;
  const above = top;
  const below = Math.max(0, rows.length - top - visible);
  const hidden = [above > 0 ? `↑ ${above}` : "", below > 0 ? `↓ ${below}` : ""].filter((part) => part !== "");

  return [`${revisions} ${revisions === 1 ? "revision" : "revisions"}`, ...hidden].join("  ");
}
