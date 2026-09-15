// The one surface that renders markdown, and the one place to swap if the checkpoint rules against
// OpenTUI. Everything else in the view draws plain rows from `bodyText`.

import { SyntaxStyle } from "@opentui/core";

// `MarkdownOptions.syntaxStyle` is required, and building one calls into the native render library.
// Creating it at import time would run before the renderer boots, so it is built on first use and
// shared from there. One pane means one instance either way.
let style: SyntaxStyle | null = null;

function syntaxStyle(): SyntaxStyle {
  style ??= SyntaxStyle.create();

  return style;
}

// An empty style map leaves OpenTUI its own token defaults. Matching the view's palette is a
// separate pass, and the shape of a fence or a list is what the pane exists to recover.
export function Markdown({ content }: { content: string }) {
  return <markdown content={content} syntaxStyle={syntaxStyle()} />;
}
