import { describe, expect, test } from "bun:test";

import notFound from "../../fixtures/errors/not-found.json";
import samlFailure from "../../fixtures/errors/saml-failure.json";

import type { Transport } from "../transport";
import { GitHubAuthError } from "./errors";
import { GitHubHttpError, GRAPHQL_URL, graphql, GraphQLRequestError } from "./graphql";

function respondWith(body: unknown, init: ResponseInit = {}): Transport {
  return async () => new Response(JSON.stringify(body), { status: 200, ...init });
}

describe("graphql", () => {
  test("posts the document and variables as JSON with the expected headers", async () => {
    let seen: Request | undefined;
    const transport: Transport = async (request) => {
      seen = request;
      return new Response('{"data":{"viewer":{"login":"octocat"}}}');
    };

    const result = await graphql<{ viewer: { login: string } }>(transport, "query { viewer { login } }", {
      number: 7,
    });

    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe(GRAPHQL_URL);
    expect(seen?.headers.get("content-type")).toBe("application/json");
    expect(seen?.headers.get("accept")).toBe("application/json");
    expect(seen?.headers.get("x-github-next-global-id")).toBe("1");
    expect(await seen?.json()).toEqual({ query: "query { viewer { login } }", variables: { number: 7 } });

    expect(result).toEqual({ data: { viewer: { login: "octocat" } }, degradations: [] });
  });

  test("attaches partial errors as degradations", async () => {
    const result = await graphql(respondWith(notFound), "query { }", {});

    expect(result.data).toEqual(notFound.data);
    expect(result.degradations).toEqual([
      { path: ["repository", "object"], message: notFound.errors[0].message },
    ]);
  });

  test("raises a SAML failure as an auth error", async () => {
    await expect(graphql(respondWith(samlFailure), "query { }", {})).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
  });

  test("raises a response with errors and no data as a request error", async () => {
    const body = { errors: [{ message: "Parse error on \"}\"" }, { message: "second" }] };

    const error = await graphql(respondWith(body), "query { }", {}).catch((caught) => caught);

    expect(error).toBeInstanceOf(GraphQLRequestError);
    expect((error as GraphQLRequestError).message).toContain("Parse error");
    expect((error as GraphQLRequestError).message).toContain("second");
    expect((error as GraphQLRequestError).errors).toHaveLength(2);
  });

  test("raises a non-2xx status with GitHub's message", async () => {
    const transport = respondWith({ message: "Bad credentials" }, { status: 401 });

    const error = await graphql(transport, "query { }", {}).catch((caught) => caught);

    expect(error).toBeInstanceOf(GitHubHttpError);
    expect((error as GitHubHttpError).status).toBe(401);
    expect((error as GitHubHttpError).message).toContain("HTTP 401");
    expect((error as GitHubHttpError).message).toContain("Bad credentials");
  });

  test("falls back to the body or status text when the error is not JSON", async () => {
    const html: Transport = async () =>
      new Response("<html>gateway down</html>\nmore", { status: 502, statusText: "Bad Gateway" });
    const empty: Transport = async () => new Response("", { status: 503, statusText: "Unavailable" });

    await expect(graphql(html, "query { }", {})).rejects.toThrow("<html>gateway down</html>");
    await expect(graphql(empty, "query { }", {})).rejects.toThrow("Unavailable");
  });
});
