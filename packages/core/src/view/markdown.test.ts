import { describe, expect, test } from "bun:test";

import { stripHtmlComments } from "./markdown";

describe("stripping html comments", () => {
  test("takes out a comment that spans several lines", () => {
    const body = "before\n<!--\nthe template says this\nand this\n-->\nafter";

    expect(stripHtmlComments(body)).toBe("before\nafter");
  });

  test("takes out both comments rather than everything between them", () => {
    const body = "a\n<!-- one -->\nkeep me\n<!-- two -->\nb";

    expect(stripHtmlComments(body)).toBe("a\nkeep me\nb");
  });

  test("leaves a fenced block alone", () => {
    const body = "```go\nfunc main() {}\n```";

    expect(stripHtmlComments(body)).toBe(body);
  });

  test("leaves list markers alone", () => {
    const body = "- one\n- two\n  - nested";

    expect(stripHtmlComments(body)).toBe(body);
  });

  // A comment that owned a paragraph leaves the blank lines either side of it behind, and those
  // read as a gap the author never wrote.
  test("closes the gap a stripped paragraph leaves", () => {
    const body = "above\n\n<!-- instructions -->\n\nbelow";

    expect(stripHtmlComments(body)).toBe("above\n\nbelow");
  });

  test("a body of nothing but a comment comes back empty", () => {
    expect(stripHtmlComments("<!-- all of it -->")).toBe("");
  });

  // A body submitted through a web form arrives with CRLF, and the gap a stripped comment leaves
  // has to close the same way it does with bare newlines.
  test("closes the gap in a body with crlf endings", () => {
    const body = "above\r\n\r\n<!-- instructions -->\r\n\r\nbelow";

    expect(stripHtmlComments(body)).toBe("above\n\nbelow");
  });
});
