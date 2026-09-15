import { describe, expect, test } from "bun:test";

import { formatPullRequestRef, InvalidPullRequestRefError, parsePullRequestRef } from "./ref";

describe("parsePullRequestRef", () => {
  test("accepts the short form", () => {
    expect(parsePullRequestRef("cli/cli#14354")).toEqual({ owner: "cli", repo: "cli", number: 14354 });
    expect(parsePullRequestRef("rust-lang/rust#137944")).toEqual({
      owner: "rust-lang",
      repo: "rust",
      number: 137944,
    });
    expect(parsePullRequestRef("ripta/some.repo_name#7")).toEqual({
      owner: "ripta",
      repo: "some.repo_name",
      number: 7,
    });
  });

  test("accepts the page URL with or without a trailing path", () => {
    const expected = { owner: "cli", repo: "cli", number: 14354 };

    expect(parsePullRequestRef("https://github.com/cli/cli/pull/14354")).toEqual(expected);
    expect(parsePullRequestRef("https://github.com/cli/cli/pull/14354/")).toEqual(expected);
    expect(parsePullRequestRef("https://github.com/cli/cli/pull/14354/files")).toEqual(expected);
    expect(parsePullRequestRef("https://github.com/cli/cli/pull/14354#issuecomment-1")).toEqual(
      expected,
    );
    expect(parsePullRequestRef("https://www.github.com/cli/cli/pull/14354?diff=split")).toEqual(
      expected,
    );
  });

  test("trims surrounding whitespace", () => {
    expect(parsePullRequestRef("  cli/cli#1\n")).toEqual({ owner: "cli", repo: "cli", number: 1 });
  });

  test("rejects everything else", () => {
    const bad = [
      "",
      "cli/cli",
      "cli/cli#0",
      "cli/cli#abc",
      "cli#14354",
      "https://github.com/cli/cli/issues/14354",
      "https://gitlab.com/cli/cli/pull/14354",
      "https://github.com/cli/cli/pull/",
      "-cli/cli#1",
    ];

    for (const input of bad) {
      expect(() => parsePullRequestRef(input)).toThrow(InvalidPullRequestRefError);
    }
  });

  test("names the input in the error", () => {
    expect(() => parsePullRequestRef("nope")).toThrow('"nope"');
  });
});

describe("formatPullRequestRef", () => {
  test("round-trips through the short form", () => {
    const ref = parsePullRequestRef("https://github.com/rust-lang/rust/pull/137944");

    expect(formatPullRequestRef(ref)).toBe("rust-lang/rust#137944");
  });
});
