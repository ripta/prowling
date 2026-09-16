// The one surface that renders markdown, and the one place to swap if the checkpoint rules against
// OpenTUI. Everything else in the view draws plain rows.

import { SyntaxStyle } from "@opentui/core";

// `MarkdownOptions.syntaxStyle` is required, and building one calls into the native render library.
// Creating it at import time would run before the renderer boots, so it is built on first use and
// shared from there.
let style: SyntaxStyle | null = null;

function syntaxStyle(): SyntaxStyle {
  style ??= SyntaxStyle.create();

  return style;
}

// NOTE: the renderable parses its content off the frame it was given it on, and does not ask for a
// redraw when the parse lands. A fenced block carries its own size and survives; the prose around it
// draws blank until something else re-renders the tree. Content mounted with the first frame is
// fine. Content that arrives later, which is every body the detail pane opens, is not.
export function Markdown({ content }: { content: string }) {
  return <markdown content={content} syntaxStyle={syntaxStyle()} />;
}
