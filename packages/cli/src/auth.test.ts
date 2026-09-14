import { describe, expect, test } from "bun:test";

import { MissingTokenError, resolveToken, type TokenSource } from "./auth";

function source(gh: string | undefined, env: string | undefined): TokenSource {
  return {
    async ghAuthToken() {
      return gh;
    },
    env() {
      return env;
    },
  };
}

describe("resolveToken", () => {
  test("uses gh auth token when it succeeds", async () => {
    expect(await resolveToken(source("gh-token", undefined))).toBe("gh-token");
  });

  test("prefers gh over GITHUB_TOKEN when both are present", async () => {
    expect(await resolveToken(source("gh-token", "env-token"))).toBe("gh-token");
  });

  test("falls back to GITHUB_TOKEN when gh yields nothing", async () => {
    expect(await resolveToken(source(undefined, "env-token"))).toBe("env-token");
  });

  test("fails clearly when neither is available", async () => {
    const error = await resolveToken(source(undefined, undefined)).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(MissingTokenError);
    expect((error as Error).message).toContain("gh auth login");
    expect((error as Error).message).toContain("GITHUB_TOKEN");
  });
});
