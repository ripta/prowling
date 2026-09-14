import { parseArgs } from "node:util";

import {
  createTransport,
  GitHubAuthError,
  ReplayMissError,
  type Transport,
  withRecording,
  withReplay,
} from "@prowling/core";

import { MissingTokenError, resolveToken } from "./auth";
import { createFileRecorder } from "./recorder";

type Mode = { kind: "live" } | { kind: "record"; dir: string } | { kind: "replay"; dir: string };

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function parseMode(argv: string[]): Mode {
  const { values } = parseArgs({
    args: argv,
    options: {
      record: { type: "string" },
      replay: { type: "string" },
    },
    strict: true,
  });

  if (values.record !== undefined && values.replay !== undefined) {
    throw new UsageError("--record and --replay cannot be combined");
  }

  if (values.record !== undefined) {
    return { kind: "record", dir: values.record };
  }

  if (values.replay !== undefined) {
    return { kind: "replay", dir: values.replay };
  }

  return { kind: "live" };
}

// Replay never reaches the network, so it resolves no token. That keeps replay usable on a machine
// with neither gh nor GITHUB_TOKEN.
async function buildTransport(mode: Mode): Promise<Transport> {
  switch (mode.kind) {
    case "replay":
      return withReplay(createFileRecorder(mode.dir));
    case "record":
      return withRecording(createTransport(await resolveToken()), createFileRecorder(mode.dir));
    case "live":
      return createTransport(await resolveToken());
  }
}

// The viewer lookup is the smallest authenticated call that exercises auth, transport, and record
// or replay end to end. The pull request query replaces it once that exists.
async function viewerLogin(transport: Transport): Promise<string> {
  const response = await transport(
    new Request("https://api.github.com/user", {
      headers: { Accept: "application/vnd.github+json" },
    }),
  );

  if (!response.ok) {
    throw new Error(`GET /user failed with HTTP ${response.status}`);
  }

  const user = (await response.json()) as { login: string };
  return user.login;
}

async function main(argv: string[]): Promise<number> {
  try {
    const transport = await buildTransport(parseMode(argv));
    console.log(await viewerLogin(transport));
    return 0;
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      console.error(error.message);
      console.error(error.remedy);
      return 1;
    }

    if (
      error instanceof UsageError ||
      error instanceof MissingTokenError ||
      error instanceof ReplayMissError
    ) {
      console.error(error.message);
      return 1;
    }

    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
