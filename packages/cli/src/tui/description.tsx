// The description region. Collapsed it shows a fixed number of lines and says how many it holds
// back. Expanded it scrolls inside a capped box, so the header stays on screen either way.

import type { DescriptionView } from "@prowling/core";

import { BORDER, clamp, usePalette } from "./theme";

// The border and the padding either side of the text.
const CHROME = 4;

// Rows the region takes once drawn, border included. The timeline is laid out against what is left,
// so the arithmetic lives with the component that decides it.
export function descriptionHeight(view: DescriptionView, expanded: boolean, expandedHeight: number): number {
  if (view.isEmpty) {
    return BORDER + 1;
  }

  if (expanded) {
    return BORDER + expandedHeight;
  }

  return BORDER + view.head.length + (view.remaining > 0 ? 1 : 0);
}

export type DescriptionProps = {
  view: DescriptionView;
  expanded: boolean;
  focused: boolean;
  // Rows the expanded scrollbox may take. Capped near half the viewport by the caller.
  expandedHeight: number;
  width: number;
};

export function Description({ view, expanded, focused, expandedHeight, width }: DescriptionProps) {
  const palette = usePalette();

  return (
    <box
      title=" description "
      style={{
        flexDirection: "column",
        flexShrink: 0,
        border: true,
        borderStyle: "rounded",
        borderColor: focused ? palette.accent : palette.dim,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {view.isEmpty ? (
        <text fg={palette.dim}>no description</text>
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
            <text fg={palette.dim}>{`… ${view.remaining} more ${plural(view.remaining)}, d to expand`}</text>
          )}
        </>
      )}
    </box>
  );
}

// An empty line still owns a row, and a text node with nothing in it collapses to none.
function Line({ text, clipped = false }: { text: string; clipped?: boolean }) {
  const palette = usePalette();
  const content = text === "" ? " " : text;

  if (clipped) {
    return (
      <text fg={palette.text} wrapMode="none">
        {content}
      </text>
    );
  }

  return <text fg={palette.text}>{content}</text>;
}

function plural(count: number): string {
  return count === 1 ? "line" : "lines";
}
