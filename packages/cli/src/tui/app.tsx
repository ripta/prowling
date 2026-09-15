// The root of the view. It owns focus, the description's expansion, and the key dispatch that
// drives both. Everything it renders comes from the normalized model, so replay and fixtures show
// the same screen a live fetch does.

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { DEFAULT_COLLAPSED_ROWS, deriveCheckRows, deriveDescription, type PullRequest } from "@prowling/core";
import { useMemo, useState } from "react";

import { Description } from "./description";
import { Header } from "./header";
import { HINTS, resolveAction } from "./keys";
import { COLORS } from "./theme";

// Tab walks this order. Phase work that adds a region appends to it and nothing else changes.
const REGIONS = ["header", "description"] as const;

export type RegionId = (typeof REGIONS)[number];

export type AppProps = {
  pullRequest: PullRequest;
  onQuit: (code: number) => void;
  collapsedRows?: number;
};

export function App({ pullRequest, onQuit, collapsedRows = DEFAULT_COLLAPSED_ROWS }: AppProps) {
  const { width, height } = useTerminalDimensions();
  const [focus, setFocus] = useState<RegionId>("header");
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => deriveCheckRows(pullRequest), [pullRequest]);
  const view = useMemo(
    () => deriveDescription(pullRequest.bodyText, { rows: collapsedRows }),
    [pullRequest.bodyText, collapsedRows],
  );

  const toggleDescription = () => {
    setExpanded((was) => {
      if (!was) {
        setFocus("description");
      }

      return !was;
    });
  };

  useKeyboard((key) => {
    switch (resolveAction(key)) {
      case "quit":
        onQuit(0);
        break;
      case "toggle-description":
        toggleDescription();
        break;
      case "focus-next":
        setFocus((current) => REGIONS[(REGIONS.indexOf(current) + 1) % REGIONS.length]);
        break;
      case "focus-prev":
        setFocus((current) => REGIONS[(REGIONS.indexOf(current) + REGIONS.length - 1) % REGIONS.length]);
        break;
      case "activate":
        if (focus === "description") {
          toggleDescription();
        }

        break;
    }
  });

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <Title pullRequest={pullRequest} />
      <Header
        pullRequest={pullRequest}
        rows={rows}
        focused={focus === "header"}
        height={checkListHeight(height)}
        width={width}
      />
      <Description
        view={view}
        expanded={expanded}
        focused={focus === "description"}
        expandedHeight={expandedHeight(height)}
        width={width}
      />
      <box style={{ flexGrow: 1 }} />
      <StatusBar />
    </box>
  );
}

function Title({ pullRequest }: { pullRequest: PullRequest }) {
  return (
    <box style={{ flexDirection: "row", flexShrink: 0, paddingLeft: 1 }}>
      <text fg={COLORS.accent}>{`#${pullRequest.number} `}</text>
      <text fg={COLORS.text}>{pullRequest.title}</text>
      <text fg={COLORS.dim}>{`  ${pullRequest.author?.login ?? "ghost"} · ${pullRequest.state}`}</text>
    </box>
  );
}

function StatusBar() {
  return (
    <box style={{ flexDirection: "row", flexShrink: 0, paddingLeft: 1 }}>
      {HINTS.map((hint) => (
        <box key={hint.keys} style={{ flexDirection: "row" }}>
          <text fg={COLORS.accent}>{hint.keys}</text>
          <text fg={COLORS.dim}>{` ${hint.label}   `}</text>
        </box>
      ))}
    </box>
  );
}

// Twenty-one checks is an ordinary count on a busy repository, and they cannot all have a row. The
// list takes about a third of the viewport and scrolls past that.
function checkListHeight(height: number): number {
  return Math.max(3, Math.floor(height * 0.35));
}

// Two rows come off for the box's own border, which is what keeps the header visible alongside a
// long description.
function expandedHeight(height: number): number {
  return Math.max(4, Math.floor(height / 2) - 2);
}
