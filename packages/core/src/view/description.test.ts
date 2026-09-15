import { describe, expect, test } from "bun:test";

import { DEFAULT_COLLAPSED_ROWS, deriveDescription } from "./description";

function body(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

describe("collapse", () => {
  test("keeps the first rows and counts the rest", () => {
    const view = deriveDescription(body(20), { rows: 8 });

    expect(view.total).toBe(20);
    expect(view.head).toHaveLength(8);
    expect(view.head[0]).toBe("line 1");
    expect(view.head[7]).toBe("line 8");
    expect(view.remaining).toBe(12);
  });

  test("leaves nothing remaining when the body fits", () => {
    const view = deriveDescription(body(3), { rows: DEFAULT_COLLAPSED_ROWS });

    expect(view.head).toEqual(view.lines);
    expect(view.remaining).toBe(0);
  });

  test("counts source lines, so a paragraph longer than the terminal is still one line", () => {
    const view = deriveDescription(`${"x".repeat(253)}\nsecond`, { rows: 8 });

    expect(view.total).toBe(2);
    expect(view.remaining).toBe(0);
  });

  test("shows nothing and holds back everything at zero rows", () => {
    const view = deriveDescription(body(4), { rows: 0 });

    expect(view.head).toEqual([]);
    expect(view.remaining).toBe(4);
  });
});

describe("normalization", () => {
  test("splits CRLF and lone CR the same as LF", () => {
    const view = deriveDescription("first\r\nsecond\rthird", { rows: 8 });

    expect(view.lines).toEqual(["first", "second", "third"]);
  });

  test("drops blank lines at either end but keeps the ones between", () => {
    const view = deriveDescription("\n  \nfirst\n\nsecond\n\n  \n", { rows: 8 });

    expect(view.lines).toEqual(["first", "", "second"]);
    expect(view.total).toBe(3);
  });
});

describe("empty bodies", () => {
  test("an empty string is empty", () => {
    const view = deriveDescription("", { rows: 8 });

    expect(view.isEmpty).toBe(true);
    expect(view.lines).toEqual([]);
    expect(view.remaining).toBe(0);
  });

  test("whitespace only is empty", () => {
    const view = deriveDescription("\n\n  \n", { rows: 8 });

    expect(view.isEmpty).toBe(true);
    expect(view.total).toBe(0);
  });

  test("a body with content is not empty", () => {
    expect(deriveDescription("first", { rows: 8 }).isEmpty).toBe(false);
  });
});
