// The description region. Collapsed it clips to a fixed number of rendered rows. Expanded it
// scrolls inside a capped box, so the header stays on screen either way.
//
// Both states render the body through the same markdown component the detail pane uses. A scrollbox
// is what clips: a fixed-height box draws a wrapping child over the rows below it instead of hiding
// it.

import type { DescriptionView } from "@prowling/core";

import { Markdown } from "./markdown";
import { BORDER, usePalette } from "./theme";

// The row the expand hint takes. Rendered rows cannot be counted ahead of the render, so the hint
// says the key rather than how much is left.
const HINT = 1;

// Rows the region takes once drawn, border included. The timeline is laid out against what is left,
// so the arithmetic lives with the component that decides it.
export function descriptionHeight(view: DescriptionView, expanded: boolean, expandedHeight: number): number {
  if (view.isEmpty) {
    return BORDER + 1;
  }

  return BORDER + (expanded ? expandedHeight : view.rows + HINT);
}

export type DescriptionProps = {
  view: DescriptionView;
  expanded: boolean;
  focused: boolean;
  // Rows the expanded scrollbox may take. Capped near half the viewport by the caller.
  expandedHeight: number;
};

export function Description({ view, expanded, focused, expandedHeight }: DescriptionProps) {
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
      ) : (
        <>
          {/* Scrolling belongs to the expanded state. Collapsed, the box is a window onto the top
              of the body and the key that opens it is the way further in. */}
          <scrollbox
            focused={focused && expanded}
            scrollY={expanded}
            style={{ height: expanded ? expandedHeight : view.rows }}
          >
            <Markdown content={view.content} />
          </scrollbox>
          {!expanded && <text fg={palette.dim}>{"… d to expand"}</text>}
        </>
      )}
    </box>
  );
}
