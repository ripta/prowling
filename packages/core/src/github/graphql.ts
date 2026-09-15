import type { Transport } from "../transport";
import { type Classified, classifyResponse, type GraphQLError } from "./errors";

export const GRAPHQL_URL = "https://api.github.com/graphql";

export class GitHubHttpError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`GitHub request failed with HTTP ${status}: ${detail}`);
    this.name = "GitHubHttpError";
    this.status = status;
  }
}

// A 200 with errors and no data at all is a broken query rather than a partial result. That is a
// bug in this program, so it surfaces as its own error instead of being classified as a degradation.
export class GraphQLRequestError extends Error {
  readonly errors: GraphQLError[];

  constructor(errors: GraphQLError[]) {
    super(`GraphQL request returned no data: ${errors.map((error) => error.message).join("; ")}`);
    this.name = "GraphQLRequestError";
    this.errors = errors;
  }
}

type GraphQLBody<T> = {
  data?: T | null;
  errors?: GraphQLError[];
};

// Every GraphQL request goes through here. The document and variables become the request body, which
// is also what record and replay hash, so the same document and variables always replay the same
// recording.
//
// X-Github-Next-Global-ID asks for node IDs in the current format. Without it, objects created
// before the format change come back with legacy IDs and the model carries a mix.
export async function graphql<T>(
  transport: Transport,
  document: string,
  variables: Record<string, unknown>,
): Promise<Classified<T>> {
  const response = await transport(
    new Request(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Github-Next-Global-ID": "1",
      },
      body: JSON.stringify({ query: document, variables }),
    }),
  );

  const text = await response.text();

  if (!response.ok) {
    throw new GitHubHttpError(response.status, httpErrorDetail(text, response.statusText));
  }

  const body = JSON.parse(text) as GraphQLBody<T>;
  const classified = classifyResponse(body.data ?? null, body.errors);

  if (classified.data === null) {
    throw new GraphQLRequestError(body.errors ?? []);
  }

  return { data: classified.data, degradations: classified.degradations };
}

// GitHub's error bodies are JSON with a message field. Anything else is reported as the status text,
// with the first line of the body when there is one.
function httpErrorDetail(text: string, statusText: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // not JSON
  }

  const firstLine = text.split("\n", 1)[0].trim();
  return firstLine === "" ? statusText : firstLine;
}
