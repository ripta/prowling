// The transport is the one function every GitHub request passes through, GraphQL and REST alike.
// Record and replay wrap it rather than living inside it, so each mode is a separate small function
// and the base transport stays a plain authenticated fetch.
//
// Only web-standard APIs appear here: fetch, Request, Response, Headers, and crypto.subtle. This
// module has to run unchanged under Bun and inside a browser extension page.

export type Transport = (request: Request) => Promise<Response>;

export type RecordedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
};

export type RecordedResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type Recording = {
  request: RecordedRequest;
  response: RecordedResponse;
};

// A Recorder stores one recording per key. The key is hashRequest's output. The CLI supplies a
// file-backed implementation; tests use an in-memory one.
export interface Recorder {
  get(key: string): Promise<Recording | undefined>;
  put(key: string, recording: Recording): Promise<void>;
}

export class ReplayMissError extends Error {
  constructor(method: string, url: string) {
    super(`no recording for ${method} ${url}`);
    this.name = "ReplayMissError";
  }
}

// The three parts are hashed as a JSON array so no combination of method, URL, and body can collide
// with another by shifting characters across the boundaries.
//
// Hex output keeps the key usable as a filename.
export async function hashRequest(method: string, url: string, body: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([method, url, body]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createTransport(token: string): Transport {
  return async (request) => {
    // Seeding from the incoming headers matters. Passing a fresh Headers to the Request constructor
    // replaces the set wholesale and would drop the caller's Accept and Content-Type.
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${token}`);

    return fetch(new Request(request, { headers }));
  };
}

export function withRecording(transport: Transport, recorder: Recorder): Transport {
  return async (request) => {
    const body = await requestBody(request);
    const key = await hashRequest(request.method, request.url, body);

    const response = await transport(request);

    const recording: Recording = {
      request: {
        method: request.method,
        url: request.url,
        headers: recordableHeaders(request.headers),
        body,
      },
      response: {
        status: response.status,
        headers: recordableHeaders(response.headers),
        body: await response.clone().text(),
      },
    };

    await recorder.put(key, recording);

    return response;
  };
}

export function withReplay(recorder: Recorder): Transport {
  return async (request) => {
    const body = await requestBody(request);
    const key = await hashRequest(request.method, request.url, body);

    const recording = await recorder.get(key);
    if (recording === undefined) {
      throw new ReplayMissError(request.method, request.url);
    }

    return new Response(recording.response.body, {
      status: recording.response.status,
      headers: recording.response.headers,
    });
  };
}

// A Request body can be read once. Reading the clone leaves the original intact for the transport
// that runs after the hash is computed.
async function requestBody(request: Request): Promise<string | null> {
  if (request.body === null) {
    return null;
  }

  return request.clone().text();
}

// This is the only place a recording is assembled from live headers, so it is the only place the
// Authorization header has to be dropped.
//
// Headers lowercases names on iteration, but the comparison is lowercased anyway so the guarantee
// does not rest on that.
function recordableHeaders(headers: Headers): Record<string, string> {
  const plain: Record<string, string> = {};

  headers.forEach((value, name) => {
    if (name.toLowerCase() !== "authorization") {
      plain[name] = value;
    }
  });

  return plain;
}
