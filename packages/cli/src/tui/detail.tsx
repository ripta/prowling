// One timeline item, opened in full. The rows behind it show `bodyText`, which flattens fences and
// list markers; this renders `body`, which keeps them.
//
// The pane scrolls itself. It is a scrollbox for the same reason the header and the description are:
// nothing here owns a cursor, so the movement keys can go straight to it.

import { type ChecksEntry, stripHtmlComments, type TimelineEntry } from "@prowling/core";

import { Markdown } from "./markdown";
import { clamp, entryColor, entryGlyph, usePalette } from "./theme";

// A checks entry counts runs and holds no prose, so there is nothing for the pane to open.
export type DetailEntry = Exclude<TimelineEntry, ChecksEntry>;

export function openable(entry: TimelineEntry): entry is DetailEntry {
  return entry.kind !== "checks";
}

export type DetailProps = {
  entry: DetailEntry;
  focused: boolean;
  // Rows the region may take, border included.
  height: number;
  width: number;
};

export function Detail({ entry, focused, height, width }: DetailProps) {
  const palette = usePalette();
  const body = stripHtmlComments(entry.body);

  return (
    <box
      title=" detail "
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
      <Byline entry={entry} width={width} />
      <scrollbox focused={focused} style={{ flexGrow: 1 }}>
        {body === "" ? <text fg={palette.dim}>no description</text> : <Markdown content={body} />}
      </scrollbox>
    </box>
  );
}

// Who wrote it and what it hangs off, which the row it opened from no longer has the width to say in
// full.
function Byline({ entry, width }: { entry: DetailEntry; width: number }) {
  const palette = usePalette();
  const author = `@${entry.author?.login ?? "ghost"}`;
  const context = contextOf(entry);

  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
      <text fg={palette[entryColor(entry)]} wrapMode="none">{`${entryGlyph(entry)} `}</text>
      <text fg={palette.accent} wrapMode="none">{`${author}  `}</text>
      <text fg={palette.dim} wrapMode="none">
        {clamp(context, Math.max(1, width - author.length - 6))}
      </text>
    </box>
  );
}

function contextOf(entry: DetailEntry): string {
  if (entry.kind === "review") {
    return entry.state;
  }

  if (entry.kind === "thread") {
    const where = entry.line === null ? entry.path : `${entry.path}:${entry.line}`;
    const state = entry.isResolved ? "resolved" : "unresolved";
    const replies = entry.replies > 0 ? `, ${entry.replies} ${entry.replies === 1 ? "reply" : "replies"}` : "";

    return `${where}  ${state}${replies}`;
  }

  return "comment";
}
