import { describe, expect, test } from "bun:test";

import type { Transport } from "../transport";
import {
  CHECK_RUN_STEPS_QUERY,
  fetchPullRequestData,
  MORE_CHECK_RUN_STEPS_QUERY,
  MORE_CHECK_RUNS_QUERY,
  MORE_CHECK_SUITES_QUERY,
  MORE_COMMITS_QUERY,
  MORE_REVIEW_REQUESTS_QUERY,
  MORE_REVIEW_THREADS_QUERY,
  MORE_THREAD_COMMENTS_QUERY,
  MORE_TIMELINE_ITEMS_QUERY,
  PULL_REQUEST_QUERY,
  PullRequestNotFoundError,
  present,
  type RawCheckRun,
  type RawCheckSuite,
  type RawPage,
  type RawPullRequest,
  type RawPullRequestCommit,
  type RawReviewComment,
  type RawReviewThread,
  type RawStep,
  type RawTimelineItem,
} from "./query";

const REF = { owner: "cli", repo: "cli", number: 14354 };

type Call = { operation: string; variables: Record<string, unknown> };

type Handler = (variables: Record<string, unknown>) => unknown;

// A transport that answers each operation by name and remembers every call in order. Handlers
// return the data object, or { data, errors } when a page should carry a degradation.
function server(handlers: Record<string, Handler>): Transport & { calls: Call[] } {
  const calls: Call[] = [];

  const transport = async (request: Request): Promise<Response> => {
    const { query, variables } = (await request.json()) as {
      query: string;
      variables: Record<string, unknown>;
    };

    const operation = /^query (\w+)/.exec(query)?.[1] ?? "?";
    calls.push({ operation, variables });

    const handler = handlers[operation];
    if (handler === undefined) {
      return new Response(JSON.stringify({ errors: [{ message: `unexpected ${operation}` }] }));
    }

    const result = handler(variables);
    const body = isEnvelope(result) ? result : { data: result };

    return new Response(JSON.stringify(body));
  };

  return Object.assign(transport, { calls });
}

function isEnvelope(value: unknown): value is { data: unknown; errors?: unknown[] } {
  return typeof value === "object" && value !== null && "data" in value;
}

function page<T>(nodes: (T | null)[], endCursor: string | null = null): RawPage<T> {
  return { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes };
}

function checkRun(id: string): RawCheckRun {
  return {
    id,
    name: id,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    startedAt: null,
    completedAt: null,
    detailsUrl: null,
    url: `https://example.test/${id}`,
    summary: null,
    title: null,
    isRequired: false,
  };
}

function checkRuns(prefix: string, count: number): RawCheckRun[] {
  return Array.from({ length: count }, (_, index) => checkRun(`${prefix}-${index + 1}`));
}

function suite(id: string, slug: string, runs: RawPage<RawCheckRun> | null): RawCheckSuite {
  return {
    id,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    url: `https://example.test/${id}`,
    app: { slug, name: slug },
    push: null,
    workflowRun: null,
    checkRuns: runs,
  };
}

function commit(id: string, suites: RawPage<RawCheckSuite> | null): RawPullRequestCommit {
  return {
    id: `prc-${id}`,
    commit: {
      id,
      oid: `${id}0000`,
      abbreviatedOid: id,
      messageHeadline: id,
      committedDate: "2025-01-01T00:00:00Z",
      authoredDate: "2025-01-01T00:00:00Z",
      author: null,
      checkSuites: suites,
    },
  };
}

function step(number: number): RawStep {
  return {
    number,
    name: `step ${number}`,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    secondsToCompletion: 1,
    startedAt: null,
    completedAt: null,
  };
}

function thread(id: string, comments: RawPage<RawReviewComment>): RawReviewThread {
  return {
    id,
    path: "file.ts",
    line: 1,
    startLine: null,
    originalLine: 1,
    originalStartLine: null,
    diffSide: "RIGHT",
    isResolved: false,
    isOutdated: false,
    isCollapsed: false,
    resolvedBy: null,
    comments,
  };
}

function comment(id: string): RawReviewComment {
  return {
    id,
    author: null,
    body: id,
    bodyText: id,
    createdAt: "2025-01-01T00:00:00Z",
    url: `https://example.test/${id}`,
    diffHunk: "",
    path: "file.ts",
    line: 1,
    originalLine: 1,
    outdated: false,
    isMinimized: false,
    commit: null,
    originalCommit: null,
    pullRequestReview: null,
    replyTo: null,
  };
}

function timelineCommit(id: string): RawTimelineItem {
  return { __typename: "PullRequestCommit", id, commit: { oid: `${id}0000` } };
}

function pullRequest(overrides: Partial<RawPullRequest>): RawPullRequest {
  return {
    id: "PR_1",
    number: REF.number,
    title: "title",
    url: "https://github.com/cli/cli/pull/14354",
    body: "",
    bodyText: "",
    state: "OPEN",
    isDraft: false,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    closedAt: null,
    mergedAt: null,
    mergeable: "MERGEABLE",
    reviewDecision: null,
    baseRefName: "trunk",
    headRefName: "feature",
    headRefOid: "abc",
    isCrossRepository: false,
    viewerDidAuthor: false,
    author: null,
    headRepository: null,
    viewerLatestReview: null,
    reviewRequests: page([]),
    timelineItems: page([]),
    reviewThreads: page([]),
    commits: page([]),
    ...overrides,
  };
}

// The scenario below overflows every connection at least once: timeline over two pages, review
// requests over two pages, a thread whose comments spill, a commit whose suites spill, a suite
// whose runs spill across three pages into 150 Actions runs so steps batch as 100 then 50, and one
// run whose steps spill. A generic suite proves non-Actions runs are left out of the step fetch.
function scenario() {
  const s1Runs = [checkRuns("s1", 50), checkRuns("s1", 100).slice(50), checkRuns("s1", 150).slice(100)];

  return server({
    PullRequest: () => ({
      viewer: { login: "octocat" },
      repository: {
        pullRequest: pullRequest({
          reviewRequests: page([{ id: "rr1", requestedReviewer: { __typename: "User", login: "a" } }], "rr-cursor"),
          timelineItems: page([timelineCommit("t1"), null], "t-cursor"),
          reviewThreads: page([thread("th1", page([comment("c1")], "c-cursor"))], "th-cursor"),
          commits: page([commit("A", page([suite("s1", "github-actions", page(s1Runs[0], "r-cursor-1"))], "s-cursor"))], "cm-cursor"),
        }),
      },
    }),

    MoreReviewRequests: () => ({
      node: { reviewRequests: page([{ id: "rr2", requestedReviewer: null }]) },
    }),

    MoreTimelineItems: () => ({
      node: { timelineItems: page([timelineCommit("t2"), timelineCommit("t3")]) },
    }),

    MoreReviewThreads: () => ({
      node: { reviewThreads: page([thread("th2", page([]))]) },
    }),

    MoreThreadComments: () => ({
      data: { node: { comments: page([comment("c2")]) } },
      errors: [{ message: "one comment hidden", path: ["node", "comments", "nodes", 1] }],
    }),

    MoreCommits: () => ({
      node: { commits: page([commit("B", null)]) },
    }),

    MoreCheckSuites: () => ({
      node: { checkSuites: page([suite("s2", "some-ci", page([checkRun("s2-1")])), null]) },
    }),

    MoreCheckRuns: ({ cursor }) => ({
      node: { checkRuns: cursor === "r-cursor-1" ? page(s1Runs[1], "r-cursor-2") : page(s1Runs[2]) },
    }),

    CheckRunSteps: ({ ids }) => ({
      nodes: (ids as string[]).map((id) =>
        id === "s1-7"
          ? { id, steps: page([step(1), step(2)], "st-cursor") }
          : { id, steps: page([step(1)]) },
      ),
    }),

    MoreCheckRunSteps: () => ({
      node: { steps: page([step(3)]) },
    }),
  });
}

describe("fetchPullRequestData", () => {
  test("drains every connection through its owning node", async () => {
    const transport = scenario();

    const { data, degradations } = await fetchPullRequestData(transport, REF);
    const pr = data.pullRequest;

    expect(data.viewer.login).toBe("octocat");

    expect(present(pr.reviewRequests?.nodes ?? []).map((request) => request.id)).toEqual(["rr1", "rr2"]);
    expect(pr.reviewRequests?.pageInfo.hasNextPage).toBe(false);

    expect(pr.timelineItems.nodes).toHaveLength(4);
    expect(present(pr.timelineItems.nodes).map((item) => item.id)).toEqual(["t1", "t2", "t3"]);

    const threads = present(pr.reviewThreads.nodes);
    expect(threads.map((item) => item.id)).toEqual(["th1", "th2"]);
    expect(present(threads[0].comments.nodes).map((item) => item.id)).toEqual(["c1", "c2"]);

    const commits = present(pr.commits.nodes);
    expect(commits.map((item) => item.commit.id)).toEqual(["A", "B"]);
    expect(commits[1].commit.checkSuites).toBeNull();

    const suites = present(commits[0].commit.checkSuites?.nodes ?? []);
    expect(suites.map((item) => item.id)).toEqual(["s1", "s2"]);
    expect(present(suites[0].checkRuns?.nodes ?? [])).toHaveLength(150);
    expect(suites[0].checkRuns?.pageInfo.hasNextPage).toBe(false);

    expect(degradations).toEqual([
      { path: ["node", "comments", "nodes", 1], message: "one comment hidden" },
    ]);
  });

  test("fetches steps for Actions runs only, in batches of 100, and pages an overflowing run", async () => {
    const transport = scenario();

    const { data } = await fetchPullRequestData(transport, REF);

    const stepCalls = transport.calls.filter((call) => call.operation === "CheckRunSteps");
    expect(stepCalls.map((call) => (call.variables.ids as string[]).length)).toEqual([100, 50]);

    const requested = stepCalls.flatMap((call) => call.variables.ids as string[]);
    expect(requested).not.toContain("s2-1");
    expect(new Set(requested).size).toBe(150);

    expect(Object.keys(data.steps)).toHaveLength(150);
    expect(data.steps["s2-1"]).toBeUndefined();
    expect(present(data.steps["s1-1"].nodes).map((item) => item.number)).toEqual([1]);
    expect(present(data.steps["s1-7"].nodes).map((item) => item.number)).toEqual([1, 2, 3]);
    expect(data.steps["s1-7"].pageInfo.hasNextPage).toBe(false);
  });

  test("sends the expected sequence of operations and cursors", async () => {
    const transport = scenario();

    await fetchPullRequestData(transport, REF);

    const sequence = transport.calls.map((call) => [call.operation, call.variables.id ?? null, call.variables.cursor ?? null]);

    expect(sequence).toEqual([
      ["PullRequest", null, null],
      ["MoreReviewRequests", "PR_1", "rr-cursor"],
      ["MoreTimelineItems", "PR_1", "t-cursor"],
      ["MoreReviewThreads", "PR_1", "th-cursor"],
      ["MoreThreadComments", "th1", "c-cursor"],
      ["MoreCommits", "PR_1", "cm-cursor"],
      ["MoreCheckSuites", "A", "s-cursor"],
      ["MoreCheckRuns", "s1", "r-cursor-1"],
      ["MoreCheckRuns", "s1", "r-cursor-2"],
      ["CheckRunSteps", null, null],
      ["MoreCheckRunSteps", "s1-7", "st-cursor"],
      ["CheckRunSteps", null, null],
    ]);

    const first = transport.calls[0];
    expect(first.variables).toEqual({ owner: "cli", repo: "cli", number: 14354 });

    const commitsPage = transport.calls.find((call) => call.operation === "MoreCommits");
    expect(commitsPage?.variables.number).toBe(14354);
  });

  test("makes one request when nothing overflows", async () => {
    const transport = server({
      PullRequest: () => ({
        viewer: { login: "octocat" },
        repository: { pullRequest: pullRequest({}) },
      }),
    });

    const { data, degradations } = await fetchPullRequestData(transport, REF);

    expect(transport.calls).toHaveLength(1);
    expect(data.steps).toEqual({});
    expect(degradations).toEqual([]);
  });

  test("raises not-found with the API's reason when the pull request is missing", async () => {
    const transport = server({
      PullRequest: () => ({
        data: { viewer: { login: "octocat" }, repository: null },
        errors: [
          {
            message: "Could not resolve to a Repository with the name 'cli/cli'.",
            path: ["repository"],
          },
        ],
      }),
    });

    const error = await fetchPullRequestData(transport, REF).catch((caught) => caught);

    expect(error).toBeInstanceOf(PullRequestNotFoundError);
    expect((error as Error).message).toContain("cli/cli#14354");
    expect((error as Error).message).toContain("Could not resolve");
  });

  test("stops when a paging target vanishes", async () => {
    const transport = server({
      PullRequest: () => ({
        viewer: { login: "octocat" },
        repository: {
          pullRequest: pullRequest({ timelineItems: page([timelineCommit("t1")], "t-cursor") }),
        },
      }),
      MoreTimelineItems: () => ({ node: null }),
    });

    await expect(fetchPullRequestData(transport, REF)).rejects.toThrow("PR_1");
  });
});

describe("documents", () => {
  const documents = {
    PULL_REQUEST_QUERY,
    MORE_REVIEW_REQUESTS_QUERY,
    MORE_TIMELINE_ITEMS_QUERY,
    MORE_REVIEW_THREADS_QUERY,
    MORE_THREAD_COMMENTS_QUERY,
    MORE_COMMITS_QUERY,
    MORE_CHECK_SUITES_QUERY,
    MORE_CHECK_RUNS_QUERY,
    CHECK_RUN_STEPS_QUERY,
    MORE_CHECK_RUN_STEPS_QUERY,
  };

  test("define every fragment they spread and spread every fragment they define", () => {
    for (const [name, document] of Object.entries(documents)) {
      const defined = new Set([...document.matchAll(/^fragment (\w+) on/gm)].map((match) => match[1]));
      const spread = new Set([...document.matchAll(/\.\.\.(\w+)/g)].map((match) => match[1]));

      expect({ name, missing: [...spread].filter((item) => !defined.has(item)) }).toEqual({ name, missing: [] });
      expect({ name, unused: [...defined].filter((item) => !spread.has(item)) }).toEqual({ name, unused: [] });
    }
  });

  test("declare $number wherever a check run is reached", () => {
    for (const [name, document] of Object.entries(documents)) {
      const reachesCheckRun = document.includes("isRequired(pullRequestNumber: $number)");
      const declares = /^query \w+\([^)]*\$number: Int!/m.test(document);

      expect({ name, declares }).toEqual({ name, declares: reachesCheckRun });
    }
  });
});
