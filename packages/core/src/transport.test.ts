import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";

import {
  createTransport,
  hashRequest,
  type Recorder,
  type Recording,
  ReplayMissError,
  type Transport,
  withRecording,
  withReplay,
} from "./transport";

type MemoryRecorder = Recorder & { store: Map<string, Recording> };

function memoryRecorder(): MemoryRecorder {
  const store = new Map<string, Recording>();

  return {
    store,
    async get(key) {
      return store.get(key);
    },
    async put(key, recording) {
      store.set(key, recording);
    },
  };
}

// Bun's fetch type carries a preconnect property, which a stub has no reason to implement. The spy
// is narrowed to the call signature so tests can pass plain functions to mockImplementation.
type FetchCall = (input: Request) => Promise<Response>;

let fetchSpy: Mock<FetchCall>;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch") as unknown as Mock<FetchCall>;
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("createTransport", () => {
  test("adds the bearer token and keeps the caller's headers", async () => {
    let seen: Request | undefined;
    fetchSpy.mockImplementation(async (input) => {
      seen = input;
      return new Response("ok");
    });

    const transport = createTransport("tok");
    await transport(
      new Request("https://api.github.com/user", {
        headers: { Accept: "application/vnd.github+json" },
      }),
    );

    expect(seen?.headers.get("authorization")).toBe("Bearer tok");
    expect(seen?.headers.get("accept")).toBe("application/vnd.github+json");
  });
});

describe("hashRequest", () => {
  test("is stable for equal inputs and sensitive to each part", async () => {
    const base = await hashRequest("POST", "https://api.github.com/graphql", "{}");

    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashRequest("POST", "https://api.github.com/graphql", "{}")).toBe(base);
    expect(await hashRequest("GET", "https://api.github.com/graphql", "{}")).not.toBe(base);
    expect(await hashRequest("POST", "https://api.github.com/user", "{}")).not.toBe(base);
    expect(await hashRequest("POST", "https://api.github.com/graphql", "[]")).not.toBe(base);
    expect(await hashRequest("POST", "https://api.github.com/graphql", null)).not.toBe(base);
  });
});

describe("withRecording", () => {
  test("stores one recording under the request hash and forwards the body intact", async () => {
    const recorder = memoryRecorder();
    const query = '{"query":"{ viewer { login } }"}';

    let forwardedBody: string | undefined;
    const inner: Transport = async (request) => {
      forwardedBody = await request.text();
      return new Response('{"data":{}}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const transport = withRecording(inner, recorder);
    const response = await transport(
      new Request("https://api.github.com/graphql", { method: "POST", body: query }),
    );

    expect(forwardedBody).toBe(query);
    expect(await response.text()).toBe('{"data":{}}');

    const key = await hashRequest("POST", "https://api.github.com/graphql", query);
    expect([...recorder.store.keys()]).toEqual([key]);

    const recording = recorder.store.get(key);
    expect(recording?.request.method).toBe("POST");
    expect(recording?.request.url).toBe("https://api.github.com/graphql");
    expect(recording?.request.body).toBe(query);
    expect(recording?.response.status).toBe(200);
    expect(recording?.response.headers["content-type"]).toBe("application/json");
    expect(recording?.response.body).toBe('{"data":{}}');
  });

  test("never writes the Authorization header from either side", async () => {
    const recorder = memoryRecorder();

    const inner: Transport = async () =>
      new Response("ok", {
        headers: {
          Authorization: "Bearer leaked-from-response",
          "X-RateLimit-Remaining": "4999",
        },
      });

    const transport = withRecording(inner, recorder);
    await transport(
      new Request("https://api.github.com/user", {
        headers: {
          Authorization: "Bearer leaked-from-request",
          Accept: "application/vnd.github+json",
        },
      }),
    );

    const [recording] = [...recorder.store.values()];
    const serialized = JSON.stringify(recording);

    expect(serialized.toLowerCase()).not.toContain("authorization");
    expect(serialized).not.toContain("leaked-from-request");
    expect(serialized).not.toContain("leaked-from-response");

    expect(recording?.request.headers["accept"]).toBe("application/vnd.github+json");
    expect(recording?.response.headers["x-ratelimit-remaining"]).toBe("4999");
  });

  test("passes a server error through without recording it", async () => {
    const recorder = memoryRecorder();
    const inner: Transport = async () => new Response("<html>bad gateway</html>", { status: 502 });

    const transport = withRecording(inner, recorder);
    const response = await transport(new Request("https://api.github.com/graphql", { method: "POST", body: "{}" }));

    expect(response.status).toBe(502);
    expect(recorder.store.size).toBe(0);
  });

  test("shows the token to fetch and not to the recorder when wrapping the base transport", async () => {
    let seen: Request | undefined;
    fetchSpy.mockImplementation(async (input) => {
      seen = input;
      return new Response("ok");
    });

    const recorder = memoryRecorder();
    const transport = withRecording(createTransport("secret-token"), recorder);
    await transport(new Request("https://api.github.com/user"));

    expect(seen?.headers.get("authorization")).toBe("Bearer secret-token");
    expect(JSON.stringify([...recorder.store.values()])).not.toContain("secret-token");
  });
});

describe("withReplay", () => {
  test("serves from the recorder without touching fetch", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error("fetch was called in replay mode");
    });

    const recorder = memoryRecorder();
    const key = await hashRequest("GET", "https://api.github.com/user", null);
    recorder.store.set(key, {
      request: { method: "GET", url: "https://api.github.com/user", headers: {}, body: null },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: '{"login":"octocat"}',
      },
    });

    const transport = withReplay(recorder);
    const response = await transport(new Request("https://api.github.com/user"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ login: "octocat" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("throws on a miss", async () => {
    const transport = withReplay(memoryRecorder());

    await expect(transport(new Request("https://api.github.com/user"))).rejects.toBeInstanceOf(
      ReplayMissError,
    );
  });
});
