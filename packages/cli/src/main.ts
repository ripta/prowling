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

// The summary stands in for the TUI. It proves the fetch worked without dumping the model.
export function summarize(pullRequest: PullRequest): string {
  const unresolved = pullRequest.threads.filter((thread) => !thread.isResolved).length;
  const checks = pullRequest.commits
    .flatMap((commit) => commit.checkSuites)
    .reduce((total, suite) => total + suite.checks.length, 0);

  return (
    `#${pullRequest.number} ${pullRequest.title} [${pullRequest.state}] ` +
    `${pullRequest.timeline.length} timeline items, ` +
    `${pullRequest.threads.length} threads (${unresolved} unresolved), ` +
    `${pullRequest.commits.length} commits, ${checks} checks`
  );
}

export async function main(argv: string[]): Promise<number> {
  try {
    const options = parseOptions(argv);
    const transport = await buildTransport(options.mode);
    const pullRequest = await fetchPullRequest(transport, options.ref);

    console.log(options.json ? JSON.stringify(pullRequest, null, 2) : summarize(pullRequest));
    return 0;
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
