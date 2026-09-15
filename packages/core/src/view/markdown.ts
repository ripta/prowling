// What the detail pane renders. `body` is raw markdown, so the pull request template's instruction
// block is still in it. `bodyText` has that stripped already, which is the whole reason the rows
// read clean and the pane would not.
//
// Stripping happens here rather than beside the renderer because the extension needs the same text
// from the same model, and this module imports nothing a terminal owns.

// A comment alone on its line takes the line with it. Removing only the comment would leave a blank
// row where the template block was, which is the same noise the pane exists to drop.
//
// Both patterns are non-greedy so two comments in one body cannot merge into one match and swallow
// the prose between them. The `[\s\S]` class rather than the `s` flag keeps them readable.
const OWN_LINE_COMMENT = /^[ \t]*<!--[\s\S]*?-->[ \t]*\n?/gm;

// What is left sits inside a line of prose, so only the comment itself comes out.
const INLINE_COMMENT = /<!--[\s\S]*?-->/g;

// Three or more newlines, which is what a stripped comment leaves behind when it had a blank line
// on either side of it.
const BLANK_RUN = /\n{3,}/g;

// Line endings are normalized first so the patterns below only ever face `\n`. A body submitted
// through a web form arrives with CRLF, which is why `deriveDescription` does the same.
//
// A fenced block holding a literal comment loses it too. Telling the two apart needs a markdown
// parse, and a comment inside a fence is rarer than a template block outside one.
export function stripHtmlComments(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(OWN_LINE_COMMENT, "")
    .replace(INLINE_COMMENT, "")
    .replace(BLANK_RUN, "\n\n")
    .trim();
}
