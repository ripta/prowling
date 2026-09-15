import { parseArgs } from "node:util";

import {
  createTransport,
  fetchPullRequest,
  GitHubAuthError,
  GitHubHttpError,
  GraphQLRequestError,
  InvalidPullRequestRefError,
  parsePullRequestRef,
  type PullRequest,
  PullRequestNotFoundError,
  type PullRequestRef,
  ReplayMissError,
  type Transport,
  withRecording,
  withReplay,
} from "@prowling/core";

import { MissingTokenError, resolveToken } from "./auth";
import { createFileRecorder } from "./recorder";
import { ensureTerminal, NotATerminalError } from "./tui/terminal";

const USAGE =
  "usage: prowling [--record <dir> | --replay <dir>] [--json] <owner/repo#N | pull request URL>";

type Mode = { kind: "live" } | { kind: "record"; dir: string } | { kind: "replay"; dir: string };

type Options = {
  mode: Mode;
  json: boolean;
  ref: PullRequestRef;
};

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseOptions(argv: string[]): Options {
  let parsed: ReturnType<typeof parseArgs<typeof config>>;

  const config = {
    args: argv,
    options: {
      record: { type: "string" },
      replay: { type: "string" },
      json: { type: "boolean" },
    },
    strict: true,
    allowPositionals: true,
  } as const;

  try {
    parsed = parseArgs(config);
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${USAGE}`);
  }

  const { values, positionals } = parsed;

  if (positionals.length !== 1) {
    throw new UsageError(USAGE);
  }

  if (values.record !== undefined && values.replay !== undefined) {
    throw new UsageError("--record and --replay cannot be combined");
  }

  let mode: Mode = { kind: "live" };
  if (values.record !== undefined) {
    mode = { kind: "record", dir: values.record };
  } else if (values.replay !== undefined) {
    mode = { kind: "replay", dir: values.replay };
  }

  return { mode, json: values.json ?? false, ref: parsePullRequestRef(positionals[0]) };
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

export type Launch = (pullRequest: PullRequest) => Promise<number>;

// Loaded at the point of use. The renderer brings a native library with it, and nothing that fails
// before a frame is drawn has any use for one. The terminal check comes first for that reason: a
// redirected stdout is the case most likely to reach here, and it needs no renderer to answer.
const launchTui: Launch = async (pullRequest) => {
  ensureTerminal();

  const { runTui } = await import("./tui/run");

  return runTui(pullRequest);
};

export async function main(argv: string[], launch: Launch = launchTui): Promise<number> {
  try {
    const options = parseOptions(argv);
    const transport = await buildTransport(options.mode);
    const pullRequest = await fetchPullRequest(transport, options.ref);

    if (options.json) {
      console.log(JSON.stringify(pullRequest, null, 2));
      return 0;
    }

    return await launch(pullRequest);
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      console.error(error.message);
      console.error(error.remedy);
      return 1;
    }

    if (
      error instanceof UsageError ||
      error instanceof InvalidPullRequestRefError ||
      error instanceof MissingTokenError ||
      error instanceof NotATerminalError ||
      error instanceof ReplayMissError ||
      error instanceof GitHubHttpError ||
      error instanceof GraphQLRequestError ||
      error instanceof PullRequestNotFoundError
    ) {
      console.error(error.message);
      return 1;
    }

    throw error;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
