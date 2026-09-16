// One revision and its items. Every row here is exactly one terminal row: text is trimmed to the
// width it was given and never wraps, because a row that wraps claims a row the window never
// budgeted for and gets drawn over its neighbour.
//
// Each row spends its width before it draws anything. A fragment that overruns does not get clipped
// on its own; the whole row compresses, and its columns stop lining up with the rows around it.

import type { TimelineEntry, TimelineGroup } from "@prowling/core";
import type { ReactNode } from "react";

import { clamp, CLOSED, ENTRY_INDENT, entryColor, entryGlyph, OPEN, usePalette } from "./theme";

// The cursor sits on a revision header, or on one of its entries.
export type Cursor = { group: number; entry: number };

export const ON_HEADER = -1;

// The column the selection marker sits in, drawn on every row so the rows line up either way.
const MARKER = 1;

// The glyph and the space after it, which every row pays for once the marker and indent are off.
const GLYPH = 2;

export function RevisionLine({
  group,
  expanded,
  selected,
  width,
}: {
  group: TimelineGroup;
  expanded: boolean;
  selected: boolean;
  width: number;
}) {
  const palette = usePalette();
  const revision = group.revision;
  const parts = [revision.headOid.slice(0, 7)];

  if (revision.origin !== "push") {
    parts.push(revision.origin);
  }

  parts.push(when(revision.pushedAt));

  if (revision.pusher !== null) {
    parts.push(revision.pusher.login);
  }

  parts.push(count(revision.commits.length, "commit"));

  // The commit count describes the revision, not the fold. A commit produces no entry of its own, so
  // a row saying "1 commit" and nothing else promises content that opening it never shows.
  if (group.entries.length > 0) {
    parts.push(count(group.entries.length, "item"));
  }

  const threads = group.unresolved > 0 ? `  ${count(group.unresolved, "unresolved thread")}` : "";
  const budget = inner(width, 0) - GLYPH - threads.length;

  return (
    <Row selected={selected} width={width}>
      <text fg={selected ? palette.accent : palette.dim} wrapMode="none">{marker(group, expanded)}</text>
      <text fg={palette.text} wrapMode="none">{clamp(parts.join("  "), budget)}</text>
      {threads !== "" && (
        <text fg={palette.bad} wrapMode="none">
          {threads}
        </text>
      )}
    </Row>
  );
}

export function EntryLine({
  entry,
  selected,
  width,
}: {
  entry: TimelineEntry;
  selected: boolean;
  width: number;
}) {
  const palette = usePalette();
  const room = inner(width, ENTRY_INDENT) - GLYPH;
  const author = `${who(entry)}  `;

  return (
    <Row selected={selected} width={width} indent={ENTRY_INDENT}>
      <text fg={palette[entryColor(entry)]} wrapMode="none">{`${entryGlyph(entry)} `}</text>
      <text fg={palette.accent} wrapMode="none">
        {author}
      </text>
      <text fg={palette.text} wrapMode="none">
        {clamp(headline(entry), Math.max(1, room - author.length))}
      </text>
    </Row>
  );
}

// A revision holding nothing has no fold, so it draws no glyph and nothing invites a press that
// would change only the glyph. The column is still paid for, which keeps the rows lining up.
function marker(group: TimelineGroup, expanded: boolean): string {
  if (group.entries.length === 0) {
    return " ".repeat(GLYPH);
  }

  return `${expanded ? OPEN : CLOSED} `;
}

// The selected row marks its left edge rather than inverting the whole line. An inverted row fights
// the colors that say what the row is.
function Row({
  children,
  selected,
  width,
  indent = 0,
}: {
  children: ReactNode;
  selected: boolean;
  width: number;
  indent?: number;
}) {
  const palette = usePalette();

  return (
    <box style={{ flexDirection: "row", width, height: 1, flexShrink: 0 }}>
      <text fg={palette.accent} wrapMode="none">{selected ? "▎" : " "}</text>
      {indent > 0 && <text wrapMode="none">{" ".repeat(indent)}</text>}
      {children}
    </box>
  );
}

// What a row has left for its own text, once the selection marker and the indent are paid for.
function inner(width: number, indent: number): number {
  return Math.max(1, width - MARKER - indent);
}

function who(entry: TimelineEntry): string {
  return `@${entry.author?.login ?? "ghost"}`;
}

// What the row says about itself before its body: the review's verdict, or where in the code the
// thread hangs. An issue comment has neither, so its body starts right away.
function headline(entry: TimelineEntry): string {
  const body = entry.bodyText.split("\n").find((line) => line.trim() !== "") ?? "";

  if (entry.kind === "review") {
    return `${entry.state}  ${body}`;
  }

  if (entry.kind === "thread") {
    const where = entry.line === null ? entry.path : `${entry.path}:${entry.line}`;
    const state = entry.isResolved ? "resolved" : "unresolved";
    const replies = entry.replies > 0 ? `, ${count(entry.replies, "reply", "replies")}` : "";

    return `${where}  ${state}${replies}  ${body}`;
  }

  return body;
}

// In the reader's own zone, since the question a timestamp answers here is when this happened
// relative to the rest of their day.
//
// An inferred revision is one nothing recorded a time for. It still happened, and saying so beats
// leaving the column blank.
function when(pushedAt: string | null): string {
  if (pushedAt === null) {
    return "time unknown";
  }

  const at = new Date(pushedAt);
  const pad = (value: number): string => String(value).padStart(2, "0");

  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function count(total: number, singular: string, plural = `${singular}s`): string {
  return `${total} ${total === 1 ? singular : plural}`;
}
