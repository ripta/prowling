import { describe, expect, test } from "bun:test";

import mixed from "../../fixtures/errors/mixed.json";
import noPath from "../../fixtures/errors/no-path.json";
import notFound from "../../fixtures/errors/not-found.json";
import samlFailure from "../../fixtures/errors/saml-failure.json";

import { classifyErrors, classifyResponse, GitHubAuthError, SAML_REMEDY } from "./errors";

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error("expected a throw");
}

describe("classifyResponse", () => {
  test("a SAML failure is fatal and carries the remedy", () => {
    const error = thrownBy(() => classifyResponse(samlFailure.data, samlFailure.errors));

    expect(error).toBeInstanceOf(GitHubAuthError);
    expect((error as GitHubAuthError).remedy).toBe(SAML_REMEDY);
    expect((error as GitHubAuthError).message).toContain("SAML enforcement");
  });

  test("a non-auth partial error yields the data with the degradation attached", () => {
    const classified = classifyResponse(notFound.data, notFound.errors);

    expect(classified.data).toBe(notFound.data);
    expect(classified.degradations).toEqual([
      { path: ["repository", "object"], message: notFound.errors[0].message },
    ]);
  });

  test("an error without a path degrades at the root", () => {
    const classified = classifyResponse(noPath.data, noPath.errors);

    expect(classified.degradations).toEqual([{ path: [], message: noPath.errors[0].message }]);
  });

  test("a SAML failure next to other errors is still fatal", () => {
    expect(() => classifyResponse(mixed.data, mixed.errors)).toThrow(GitHubAuthError);
  });
});

describe("classifyErrors", () => {
  test("no errors means no degradations", () => {
    expect(classifyErrors(undefined)).toEqual([]);
    expect(classifyErrors([])).toEqual([]);
  });
});
