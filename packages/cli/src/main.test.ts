import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { join } from "node:path";

import { main, parseOptions, UsageError } from "./main";
import { FIXTURES_DIR } from "./record-fixtures";

const FIXTURE = join(FIXTURES_DIR, "cli-cli-14349");

let log: Mock<typeof console.log>;
let error: Mock<typeof console.error>;

beforeEach(() => {
  log = spyOn(console, "log").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  error.mockRestore();
});

function printed(mock: Mock<(...args: unknown[]) => void>): string {
  return mock.mock.calls.map((call) => call.join(" ")).join("\n");
}

describe("parseOptions", () => {
  test("takes one reference, a mode, and the json flag", () => {
    expect(parseOptions(["cli/cli#1"])).toEqual({
      mode: { kind: "live" },
      json: false,
      ref: { owner: "cli", repo: "cli", number: 1 },
    });

    expect(parseOptions(["--json", "--replay", "dir", "https://github.com/cli/cli/pull/2"])).toEqual({
      mode: { kind: "replay", dir: "dir" },
      json: true,
      ref: { owner: "cli", repo: "cli", number: 2 },
    });

    expect(parseOptions(["--record", "dir", "cli/cli#3"]).mode).toEqual({ kind: "record", dir: "dir" });
  });

  test("rejects a missing or extra reference, combined modes, and unknown flags", () => {
    expect(() => parseOptions([])).toThrow(UsageError);
    expect(() => parseOptions(["cli/cli#1", "cli/cli#2"])).toThrow(UsageError);
    expect(() => parseOptions(["--record", "a", "--replay", "b", "cli/cli#1"])).toThrow(UsageError);
    expect(() => parseOptions(["--bogus", "cli/cli#1"])).toThrow(UsageError);
    expect(() => parseOptions(["--bogus", "cli/cli#1"])).toThrow("--bogus");
  });
});

describe("main", () => {
  test("--json prints the normalized model from a replay", async () => {
    const code = await main(["--replay", FIXTURE, "--json", "cli/cli#14349"]);

    expect(code).toBe(0);
    expect(error).not.toHaveBeenCalled();

    const model = JSON.parse(printed(log));
    expect(model.number).toBe(14349);
    expect(model.commits).toHaveLength(1);
    expect(model.timeline.map((item: { kind: string }) => item.kind)).toEqual(["commit", "force-push"]);
  });

  test("prints a one-line summary without --json", async () => {
    const code = await main(["--replay", FIXTURE, "cli/cli#14349"]);

    expect(code).toBe(0);
    expect(printed(log)).toBe(
      "#14349 Refactor git graph tests to use real repositories [OPEN] " +
        "2 timeline items, 0 threads (0 unresolved), 2 revisions, 1 commits, 23 checks",
    );
  });

  test("reports usage and reference errors on stderr with exit 1", async () => {
    expect(await main([])).toBe(1);
    expect(printed(error)).toContain("usage:");

    error.mockClear();
    expect(await main(["nope"])).toBe(1);
    expect(printed(error)).toContain("not a pull request reference");

    expect(log).not.toHaveBeenCalled();
  });

  test("reports a replay miss with exit 1", async () => {
    const code = await main(["--replay", FIXTURE, "cli/cli#1"]);

    expect(code).toBe(1);
    expect(printed(error)).toContain("no recording for POST https://api.github.com/graphql");
  });
});
