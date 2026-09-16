// The description region. Collapsed it clips to a fixed number of rendered rows. Expanded it
// scrolls inside a capped box, so the header stays on screen either way.
//
// Both states render the body through the same markdown component the detail pane uses. A scrollbox
// is what clips: a fixed-height box draws a wrapping child over the rows below it instead of hiding
// it.

import type { ScrollBoxRenderable } from "@opentui/core";
import type { DescriptionView } from "@prowling/core";
import { useEffect, useRef } from "react";

import { Markdown } from "./markdown";
import { BORDER, usePalette } from "./theme";

// Rows the region takes once drawn, border included. The timeline is laid out against what is left,
// so the arithmetic lives with the component that decides it.
export function descriptionHeight(view: DescriptionView, expanded: boolean, expandedHeight: number): number {
  if (view.isEmpty) {
    return BORDER + 1;
  }

  return BORDER + (expanded ? expandedHeight : view.rows);
}

// The title says which state the region is in and the key out of it. Carrying it on the border
// costs the timeline no rows, and the region answers the same question open or closed.
//
// An empty description has nothing to open, so it names itself and no key.
function titleFor(view: DescriptionView, expanded: boolean): string {
  if (view.isEmpty) {
    return " description ";
  }

  return expanded ? " description (expanded, d to collapse) " : " description (collapsed, d to expand) ";
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
  const box = useRef<ScrollBoxRenderable>(null);

  // `scrollY` is read once, when the scrollbox is constructed, and the renderable exposes no setter
  // for it. So the box is built to scroll in both states, and collapsing hides the bar rather than
  // giving up the scroll range. Rebuilding the box per state would also reparse the whole body on
  // every toggle.
  //
  // Collapsing also returns the box to the top, since the collapsed region is a window onto the
  // start of the body rather than onto wherever reading left off.
  useEffect(() => {
    const scroll = box.current;

    if (scroll === null) {
      return;
    }

    if (expanded) {
      scroll.verticalScrollBar.resetVisibilityControl();
      return;
    }

    scroll.scrollTop = 0;
    scroll.verticalScrollBar.visible = false;
  }, [expanded]);

  return (
    <box
      title={titleFor(view, expanded)}
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
        /* Scrolling belongs to the expanded state. Collapsed, the box is a window onto the top of
           the body and the key the title names is the way further in. */
        <scrollbox
          ref={box}
          focused={focused && expanded}
          scrollY
          style={{ height: expanded ? expandedHeight : view.rows }}
        >
          <Markdown content={view.content} />
        </scrollbox>
      )}
    </box>
  );
}
