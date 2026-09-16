// The one surface that renders markdown, and the one place to swap if the checkpoint rules against
// OpenTUI. Everything else in the view draws plain rows.

import { SyntaxStyle } from "@opentui/core";

import { type Palette, usePalette } from "./theme";

// The token names the markdown renderable resolves. Leaving them unregistered does not fall back to
// the surrounding foreground: the renderer substitutes its own defaults, which are chosen for a dark
// background and reach about 1.3:1 on a light one.
//
// So the palette supplies them, the same way every other row in the view resolves a role rather than
// naming a hex.
function stylesFor(palette: Palette): Record<string, { fg: string; bold?: boolean; italic?: boolean }> {
  return {
    default: { fg: palette.text },
    conceal: { fg: palette.dim },
    "markup.heading": { fg: palette.text, bold: true },
    "markup.strong": { fg: palette.text, bold: true },
    "markup.italic": { fg: palette.text, italic: true },
    "markup.strikethrough": { fg: palette.dim },
    "markup.list": { fg: palette.dim },
    "markup.quote": { fg: palette.dim },
    "markup.raw": { fg: palette.accent },
    "markup.link": { fg: palette.accent },
    "markup.link.label": { fg: palette.accent },
    "markup.link.url": { fg: palette.dim },
  };
}

// Building a style calls into the native render library, so it cannot happen at import time: the
// renderer has not booted yet. It is built on first use per palette instead, and a terminal that
// switches background mid-run gets the second one built then.
const styles = new Map<Palette, SyntaxStyle>();

function syntaxStyle(palette: Palette): SyntaxStyle {
  let style = styles.get(palette);

  if (style === undefined) {
    style = SyntaxStyle.fromStyles(stylesFor(palette));
    styles.set(palette, style);
  }

  return style;
}

// The prose blocks wait on tree-sitter. A fenced block carries its own size and draws on the frame it
// mounts on. Everything around it stays blank until the highlight lands, and the renderable asks for
// the frame that fills it. That round trip measured 2ms against a thread body from `cli/cli#14354`.
//
// So this costs a reader nothing and costs a test everything. A capture taken on the mounting frame
// reads a fence over blank rows, which is why the harness pumps frames before it asserts.
export function Markdown({ content }: { content: string }) {
  const palette = usePalette();

  return <markdown content={content} syntaxStyle={syntaxStyle(palette)} fg={palette.text} />;
}
