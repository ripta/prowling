import { describe, expect, test } from "bun:test";

import { DEFAULT_COLLAPSED_ROWS, deriveDescription } from "./description";

describe("the collapsed height", () => {
  test("carries the rows the region was asked for", () => {
    expect(deriveDescription("first", { rows: 8 }).rows).toBe(8);
    expect(deriveDescription("first", { rows: DEFAULT_COLLAPSED_ROWS }).rows).toBe(DEFAULT_COLLAPSED_ROWS);
  });

  test("never goes negative", () => {
    expect(deriveDescription("first", { rows: -3 }).rows).toBe(0);
  });
});

describe("the content", () => {
  // What the old bodyText source dropped. The renderer needs the break to put a gap between two
  // paragraphs, and the marker to know the line is a heading.
  test("keeps the blank lines and the heading markers the renderer reads", () => {
    const view = deriveDescription("Depends on #14320.\n\n### Description\n\nFirst para.\n\nSecond para.", { rows: 8 });

    expect(view.content).toBe("Depends on #14320.\n\n### Description\n\nFirst para.\n\nSecond para.");
  });

  test("strips the pull request template's comment block", () => {
    const view = deriveDescription("<!--\nthanks for contributing\n-->\n\nDepends on #14320.", { rows: 8 });

    expect(view.content).toBe("Depends on #14320.");
  });

  test("normalizes CRLF and lone CR", () => {
    expect(deriveDescription("first\r\nsecond\rthird", { rows: 8 }).content).toBe("first\nsecond\nthird");
  });

  test("drops blank lines at either end and keeps the ones between", () => {
    expect(deriveDescription("\n  \nfirst\n\nsecond\n\n  \n", { rows: 8 }).content).toBe("first\n\nsecond");
  });
});

describe("empty bodies", () => {
  test("an empty string is empty", () => {
    const view = deriveDescription("", { rows: 8 });

    expect(view.isEmpty).toBe(true);
    expect(view.content).toBe("");
  });

  test("whitespace only is empty", () => {
    expect(deriveDescription("\n\n  \n", { rows: 8 }).isEmpty).toBe(true);
  });

  // A template that is nothing but its own instructions leaves no description behind.
  test("a body of nothing but comments is empty", () => {
    expect(deriveDescription("<!-- fill this in -->", { rows: 8 }).isEmpty).toBe(true);
  });

  test("a body with content is not empty", () => {
    expect(deriveDescription("first", { rows: 8 }).isEmpty).toBe(false);
  });
});
