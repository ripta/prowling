// The description region's collapsed view. The body arrives as bodyText, which has already had its
// HTML comments stripped, so a pull request template leaves nothing behind here.
//
// Lines are source lines, not display lines. A terminal wraps a long paragraph across several rows,
// and nothing here knows the width it will wrap at. Measuring display lines would mean
// reimplementing the wrap or reading a height back after a layout pass, so the count stays exact
// about the source and says nothing about the screen. The renderer clips the collapsed region to a
// fixed height, which is what keeps a long paragraph from pushing the rest of the view off screen.

// Where the collapse starts. A layout knob rather than a fixed rule, tuned against real pull
// requests.
export const DEFAULT_COLLAPSED_ROWS = 8;

export type DescriptionOptions = {
  // How many lines the collapsed region shows.
  rows: number;
};

export type DescriptionView = {
  // The whole body, blank lines at either end removed.
  lines: string[];
  total: number;
  // The prefix the collapsed region shows.
  head: string[];
  // Lines the collapsed region leaves out. Never negative.
  remaining: number;
  // A body of nothing but whitespace reads as empty, since it renders as empty.
  isEmpty: boolean;
};

export function deriveDescription(bodyText: string, options: DescriptionOptions): DescriptionView {
  const lines = trimBlankEdges(bodyText.replace(/\r\n?/g, "\n").split("\n"));
  const head = lines.slice(0, Math.max(0, options.rows));

  return {
    lines,
    total: lines.length,
    head,
    remaining: lines.length - head.length,
    isEmpty: lines.length === 0,
  };
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") {
    start += 1;
  }

  while (end > start && lines[end - 1].trim() === "") {
    end -= 1;
  }

  return lines.slice(start, end);
}
