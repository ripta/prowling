// The root of the view. It owns focus, the description's expansion, the timeline's expansion and
// cursor, and the key dispatch that drives all of them. Everything it renders comes from the
// normalized model, so replay and fixtures show the same screen a live fetch does.

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import {
  DEFAULT_COLLAPSED_ROWS,
  deriveCheckRows,
  deriveDescription,
  deriveTimeline,
  openingRevision,
  type PullRequest,
} from "@prowling/core";
import { useMemo, useState } from "react";

import { Detail, type DetailEntry } from "./detail";
import { Description, descriptionHeight } from "./description";
import { type ChecksMode, Header, headerHeight, nextChecksMode } from "./header";
import { hintsFor, REGIONS, type RegionId, resolveAction } from "./keys";
import { type Cursor, ON_HEADER } from "./revision";
import { DARK, type Palette, PaletteContext, usePalette } from "./theme";
import { cursorsOf, flattenRows, sameCursor, Timeline } from "./timeline";

// The title line and the status bar, which sit outside every region.
const FRAME_ROWS = 2;

// Border, footer, and enough rows to see a revision alongside one of its items. Below this the
// terminal is too short for the view either way.
const MIN_TIMELINE_ROWS = 5;

export type AppProps = {
  pullRequest: PullRequest;
  onQuit: (code: number) => void;
  collapsedRows?: number;
  // Which background the terminal reported. The caller owns the query, so a test mounts this
  // without one and a component below reads the result through the context rather than a prop.
  palette?: Palette;
};

export function App({
  pullRequest,
  onQuit,
  collapsedRows = DEFAULT_COLLAPSED_ROWS,
  palette = DARK,
}: AppProps) {
  const { width, height } = useTerminalDimensions();
  const [focus, setFocus] = useState<RegionId>("header");
  const [expanded, setExpanded] = useState(false);
  const [checks, setChecks] = useState<ChecksMode>("summary");

  const rows = useMemo(() => deriveCheckRows(pullRequest), [pullRequest]);
  const view = useMemo(
    () => deriveDescription(pullRequest.body, { rows: collapsedRows }),
    [pullRequest.body, collapsedRows],
  );
  const groups = useMemo(() => deriveTimeline(pullRequest), [pullRequest]);

  const [open, setOpen] = useState(
    () => new Set(groups.filter((group) => group.startsExpanded).map((group) => group.index)),
  );
  const [cursor, setCursor] = useState<Cursor>(() => ({
    group: openingRevision(groups),
    entry: ON_HEADER,
  }));

  // The open item, held rather than derived from the cursor. The pane covers the timeline, so the
  // cursor may not move while it is open, and holding it keeps the pane showing what was opened.
  const [detail, setDetail] = useState<DetailEntry | null>(null);

  const timelineRows = useMemo(() => flattenRows(groups, open), [groups, open]);
  const cursors = useMemo(() => cursorsOf(timelineRows), [timelineRows]);

  // Expanding leaves the focus alone, the same way cycling the check list does. Tab is the only
  // thing that moves focus.
  //
  // Moving it from here also moved it once per queued press. A held key batches into a single
  // render, so an even number of presses left the region collapsed with the focus on it anyway.
  const toggleDescription = () => {
    setExpanded((was) => !was);
  };

  // Collapsing a revision takes its items away, so the cursor lands back on the header rather than
  // on a row that no longer exists.
  //
  // A revision holding nothing has no fold at all. Its row draws no glyph, and the key does nothing
  // rather than flipping a state the reader has no way to see.
  const toggleRevision = () => {
    if ((groups[cursor.group]?.entries.length ?? 0) === 0) {
      return;
    }

    setOpen((was) => {
      const next = new Set(was);

      if (!next.delete(cursor.group)) {
        next.add(cursor.group);
      }

      return next;
    });

    setCursor({ group: cursor.group, entry: ON_HEADER });
  };

  // Both movers step from the cursor the updater is handed rather than the one this render closed
  // over. A held key batches its presses into a single render, and reading the closure moved the
  // cursor one step however many arrived.
  const moveCursor = (delta: number) => {
    setCursor((was) => {
      const at = cursors.findIndex((candidate) => sameCursor(candidate, was));

      if (at === -1) {
        return { group: was.group, entry: ON_HEADER };
      }

      return cursors[Math.min(cursors.length - 1, Math.max(0, at + delta))] ?? was;
    });
  };

  const moveRevision = (delta: number) => {
    setCursor((was) => ({
      group: Math.min(groups.length - 1, Math.max(0, was.group + delta)),
      entry: ON_HEADER,
    }));
  };

  // Reports whether anything opened. A revision header has no item under it, so it has no pane to
  // show and the key falls through to collapsing the group.
  const openDetail = (): boolean => {
    const row = timelineRows.find((candidate) => candidate.kind === "entry" && sameCursor(candidate.at, cursor));

    if (row?.kind !== "entry") {
      return false;
    }

    setDetail(row.entry);
    setFocus("detail");

    return true;
  };

  const closeDetail = () => {
    setDetail(null);
    setFocus("timeline");
  };

  useKeyboard((key) => {
    switch (resolveAction(key, focus)) {
      case "quit":
        onQuit(0);
        break;
      case "toggle-description":
        toggleDescription();
        break;
      case "cycle-checks":
        setChecks((was) => nextChecksMode(was, rows));
        break;
      case "focus-next":
        setFocus((current) => step(current, 1));
        break;
      case "focus-prev":
        setFocus((current) => step(current, -1));
        break;
      case "activate":
        if (focus === "description") {
          toggleDescription();
        }

        // The key opens whatever the cursor is on. Where there is nothing to open it falls back to
        // the group, which keeps collapsing a revision from inside it on the same key.
        if (focus === "timeline" && !openDetail()) {
          toggleRevision();
        }

        break;
      case "close-detail":
        closeDetail();
        break;
      case "item-next":
        moveCursor(1);
        break;
      case "item-prev":
        moveCursor(-1);
        break;
      case "revision-next":
        moveRevision(1);
        break;
      case "revision-prev":
        moveRevision(-1);
        break;
    }
  });

  return (
    <PaletteContext value={palette}>
      <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
        <Title pullRequest={pullRequest} />
        <Header
          pullRequest={pullRequest}
          rows={rows}
          mode={checks}
          focused={focus === "header"}
          height={checkListHeight(height)}
          width={width}
        />
        <Description
          view={view}
          expanded={expanded}
          focused={focus === "description"}
          expandedHeight={expandedHeight(height)}
        />
        {detail === null ? (
          <Timeline
            rows={timelineRows}
            cursor={cursor}
            focused={focus === "timeline"}
            height={timelineHeight(pullRequest, rows, checks, view, expanded, height)}
            width={width}
          />
        ) : (
          <Detail
            entry={detail}
            focused={focus === "detail"}
            height={timelineHeight(pullRequest, rows, checks, view, expanded, height)}
            width={width}
          />
        )}
        <box style={{ flexGrow: 1 }} />
        <StatusBar region={focus} />
      </box>
    </PaletteContext>
  );
}

// One step around the tab ring.
//
// The detail pane sits outside the ring, so it reports no position and a step from there lands
// wherever the arithmetic falls. That never happens: the pane claims no key that resolves to focus
// movement, and closing it puts the focus back on the timeline itself.
function step(current: RegionId, delta: number): RegionId {
  const at = REGIONS.findIndex((region) => region === current);

  return REGIONS[(at + delta + REGIONS.length) % REGIONS.length];
}

function Title({ pullRequest }: { pullRequest: PullRequest }) {
  const palette = usePalette();

  return (
    <box style={{ flexDirection: "row", flexShrink: 0, paddingLeft: 1 }}>
      <text fg={palette.accent}>{`#${pullRequest.number} `}</text>
      <text fg={palette.text}>{pullRequest.title}</text>
      <text fg={palette.dim}>{`  ${pullRequest.author?.login ?? "ghost"} · ${pullRequest.state}`}</text>
    </box>
  );
}

function StatusBar({ region }: { region: RegionId }) {
  const palette = usePalette();

  return (
    <box style={{ flexDirection: "row", flexShrink: 0, paddingLeft: 1 }}>
      {hintsFor(region).map((hint) => (
        <box key={hint.keys} style={{ flexDirection: "row" }}>
          <text fg={palette.accent}>{hint.keys}</text>
          <text fg={palette.dim}>{` ${hint.label}   `}</text>
        </box>
      ))}
    </box>
  );
}

// Twenty-one checks is an ordinary count on a busy repository, and they cannot all have a row. An
// opened list takes about a third of the viewport and scrolls past that. It opens only when asked,
// so the timeline keeps those rows the rest of the time.
function checkListHeight(height: number): number {
  return Math.max(3, Math.floor(height * 0.35));
}

// Two rows come off for the box's own border, which is what keeps the header visible alongside a
// long description.
function expandedHeight(height: number): number {
  return Math.max(4, Math.floor(height / 2) - 2);
}

// The timeline takes what the regions above it leave. Each of those reports its own height, so this
// stays a sum rather than a second copy of their layout rules.
function timelineHeight(
  pullRequest: PullRequest,
  rows: ReturnType<typeof deriveCheckRows>,
  checks: ChecksMode,
  view: ReturnType<typeof deriveDescription>,
  expanded: boolean,
  height: number,
): number {
  const above =
    FRAME_ROWS +
    headerHeight(pullRequest, rows, checks, checkListHeight(height)) +
    descriptionHeight(view, expanded, expandedHeight(height));

  return Math.max(MIN_TIMELINE_ROWS, height - above);
}
