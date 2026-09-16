// The description region's source text. The body arrives as markdown and the renderer draws it:
// markers concealed, paragraphs wrapped to the width, links spelled out with their URL. So nothing
// here can say how many rows it will take.
//
// That is why the collapsed region clips to a fixed number of rendered rows rather than to a count
// taken here. A source line count does not survive the render, and measuring the render would mean
// reading a height back after a layout pass.
//
// `bodyText` used to feed this. It is GitHub's own plaintext flattening, and it drops the paragraph
// breaks and heading markers the web view shows.

import { stripHtmlComments } from "./markdown";

// Where the collapse starts, in rendered rows. A layout knob rather than a fixed rule, tuned
// against real pull requests.
export const DEFAULT_COLLAPSED_ROWS = 8;

export type DescriptionOptions = {
  // Rendered rows the collapsed region shows.
  rows: number;
};

export type DescriptionView = {
  // Ready for the markdown renderer: HTML comments gone, blank edges trimmed.
  content: string;
  // Rendered rows the collapsed region shows.
  rows: number;
  // A body of nothing but whitespace reads as empty, since it renders as empty.
  isEmpty: boolean;
};

export function deriveDescription(body: string, options: DescriptionOptions): DescriptionView {
  const content = stripHtmlComments(body);

  return {
    content,
    rows: Math.max(0, options.rows),
    isEmpty: content === "",
  };
}
