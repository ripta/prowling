// The description region. Collapsed it shows a fixed number of lines and says how many it holds
// back. Expanded it scrolls inside a capped box, so the header stays on screen either way.

import type { DescriptionView } from "@prowling/core";

import { clamp, COLORS } from "./theme";

// The border and the padding either side of the text.
const CHROME = 4;

export type DescriptionProps = {
  view: DescriptionView;
  expanded: boolean;
  focused: boolean;
  // Rows the expanded scrollbox may take. Capped near half the viewport by the caller.
  expandedHeight: number;
  width: number;
};

export function Description({ view, expanded, focused, expandedHeight, width }: DescriptionProps) {
  return (
    <box
      title=" description "
      style={{
        flexDirection: "column",
        flexShrink: 0,
        border: true,
        borderStyle: "rounded",
        borderColor: focused ? COLORS.accent : COLORS.dim,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {view.isEmpty ? (
        <text fg={COLORS.dim}>no description</text>
      ) : expanded ? (
        <scrollbox focused={focused} scrollY viewportCulling style={{ height: expandedHeight }}>
          {view.lines.map((line, index) => (
            <Line key={index} text={line} />
          ))}
        </scrollbox>
      ) : (
        <>
          {/* One row per line, cut at the right edge rather than wrapped. A wrapped line would
              claim rows the budget never counted, and a box that clips them draws the overflow
              over its neighbours instead of hiding it. */}
          <box style={{ flexDirection: "column", height: view.head.length }}>
            {view.head.map((line, index) => (
              <Line key={index} text={clamp(line, Math.max(1, width - CHROME))} clipped />
            ))}
          </box>
          {view.remaining > 0 && (
            <text fg={COLORS.dim}>{`… ${view.remaining} more ${plural(view.remaining)}, d to expand`}</text>
          )}
        </>
      )}
    </box>
  );
}

// An empty line still owns a row, and a text node with nothing in it collapses to none.
function Line({ text, clipped = false }: { text: string; clipped?: boolean }) {
  const content = text === "" ? " " : text;

  if (clipped) {
    return (
      <text fg={COLORS.text} wrapMode="none">
        {content}
      </text>
    );
  }

  return <text fg={COLORS.text}>{content}</text>;
}

function plural(count: number): string {
  return count === 1 ? "line" : "lines";
}
