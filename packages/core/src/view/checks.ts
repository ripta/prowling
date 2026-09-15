// One row per check name for the state header, each reporting that check's latest known result.
//
// A check run carries no pointer to the revision it ran against. The link runs through the commit
// that owns the run, matched against the revision that introduced that commit. Runs on commits a
// force-push dropped count too: they are how a check that stopped running still reports its last
// result.
//
// A name is known only because a run of it was seen. Nothing in the response lists the checks a
// branch expects but never got, so a check that truly never registered cannot appear here at all.
// What can appear is a run that registered and never started, and that is what never-run means
// below.

import type { Check, CheckConclusion, CheckStatus, Commit, Revision } from "../model";

// The fields a row is built from. Check satisfies this, so a caller passes the model straight in
// and a test builds a run without filling in steps and urls it does not exercise.
export type CheckRun = Pick<
  Check,
  "id" | "name" | "status" | "conclusion" | "startedAt" | "completedAt" | "detailsUrl" | "isRequired"
>;

export type CheckCommit = {
  oid: string;
  checkSuites: readonly { checks: readonly CheckRun[] }[];
};

// PullRequest satisfies this structurally.
export type CheckRowsInput = {
  revisions: readonly Pick<Revision, "headOid" | "commits">[];
  commits: readonly CheckCommit[];
  droppedCommits: readonly CheckCommit[];
};

// current  a run on the newest revision reached COMPLETED. Its conclusion says the rest, and
//          SKIPPED is a conclusion like any other.
// pending  a run on the newest revision has not completed.
// stale    nothing ran on the newest revision, so the row reports an older one and names it.
// missing  no run of this name ever started, and it gates the merge.
//
// A check that never started and does not gate the merge produces no row. It never ran and cannot
// block anything, which makes it the same kind of noise as a procedural comment.
export type CheckRowKind = "current" | "pending" | "stale" | "missing";

export type StaleRef = {
  // Indexes the revisions passed in. null when the run's commit belongs to no revision.
  revision: number | null;
  // Seven characters of the revision's head, or of the run's own commit when there is no revision.
  oid: string;
  // How far back from the newest revision. At least 1, and null alongside a null revision.
  back: number | null;
};

// kind says what the row means. The remaining fields report the run standing behind it, which is
// the newest run that qualified under that kind.
export type CheckRow = {
  name: string;
  kind: CheckRowKind;
  status: CheckStatus | null;
  conclusion: CheckConclusion | null;
  isRequired: boolean;
  checkId: string | null;
  detailsUrl: string | null;
  staleOn: StaleRef | null;
};

const FAILING: ReadonlySet<CheckConclusion> = new Set<CheckConclusion>([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
  "STALE",
]);

const MUTED: ReadonlySet<CheckConclusion> = new Set<CheckConclusion>(["NEUTRAL", "CANCELLED"]);

type Run = {
  run: CheckRun;
  oid: string;
  revision: number | undefined;
};

export function deriveCheckRows(input: CheckRowsInput): CheckRow[] {
  const byOid = revisionIndexByOid(input.revisions);
  const newest = input.revisions.length - 1;
  const byName = new Map<string, Run[]>();

  for (const commit of [...input.commits, ...input.droppedCommits]) {
    for (const suite of commit.checkSuites) {
      for (const run of suite.checks) {
        const runs = byName.get(run.name) ?? [];

        runs.push({ run, oid: commit.oid, revision: byOid.get(commit.oid) });
        byName.set(run.name, runs);
      }
    }
  }

  const rows: CheckRow[] = [];

  for (const [name, runs] of byName) {
    const row = buildRow(name, runs, newest, input.revisions);

    if (row !== null) {
      rows.push(row);
    }
  }

  return rows.sort(
    (a, b) => rowRank(a) - rowRank(b) || Number(b.isRequired) - Number(a.isRequired) || compareNames(a.name, b.name),
  );
}

// Where a commit sits in the chain. A revision lists the commits it introduced, and its head when
// that commit no longer survives on the branch.
//
// The newest revision naming an oid wins. A force-push away and back gives one oid two revisions,
// and the question a row answers is whether the run covers the head as it stands now.
export function revisionIndexByOid(revisions: readonly Pick<Revision, "headOid" | "commits">[]): Map<string, number> {
  const byOid = new Map<string, number>();

  revisions.forEach((revision, index) => {
    for (const oid of revision.commits) {
      byOid.set(oid, index);
    }

    byOid.set(revision.headOid, index);
  });

  return byOid;
}

// Attention first. Ten of the twenty-one names on a real pull request report stale, so ordering by
// name buries the one row that needs acting on below the fold of a scrollbox.
export function rowRank(row: CheckRow): number {
  if (row.conclusion !== null && FAILING.has(row.conclusion)) {
    return 0;
  }

  if (row.kind === "missing") {
    return 1;
  }

  if (row.kind === "pending") {
    return 2;
  }

  if (row.kind === "stale") {
    return 3;
  }

  if (row.conclusion !== null && MUTED.has(row.conclusion)) {
    return 4;
  }

  return row.conclusion === "SKIPPED" ? 5 : 6;
}

function buildRow(
  name: string,
  runs: Run[],
  newest: number,
  revisions: readonly Pick<Revision, "headOid" | "commits">[],
): CheckRow | null {
  const onNewest = runs.filter((entry) => entry.revision === newest);

  if (onNewest.length > 0) {
    const latest = pick(onNewest, beats);

    return row(name, completed(latest.run) ? "current" : "pending", latest, null);
  }

  const older = runs.filter((entry) => completed(entry.run));

  if (older.length > 0) {
    const latest = pick(older, staler);

    return row(name, "stale", latest, staleRef(latest, newest, revisions));
  }

  if (runs.every((entry) => entry.run.startedAt === null && entry.run.conclusion === null)) {
    if (!runs.some((entry) => entry.run.isRequired)) {
      return null;
    }

    const latest = pick(runs, staler);

    return { ...row(name, "missing", latest, null), isRequired: true };
  }

  // A run started on an older revision and never reported back, which the three branches above
  // leave uncovered. It is stale like any other older result, with nothing to report but a status.
  const latest = pick(runs, staler);

  return row(name, "stale", latest, staleRef(latest, newest, revisions));
}

function row(name: string, kind: CheckRowKind, entry: Run, staleOn: StaleRef | null): CheckRow {
  return {
    name,
    kind,
    status: entry.run.status,
    conclusion: entry.run.conclusion,
    isRequired: entry.run.isRequired,
    checkId: entry.run.id,
    detailsUrl: entry.run.detailsUrl,
    staleOn,
  };
}

function staleRef(
  entry: Run,
  newest: number,
  revisions: readonly Pick<Revision, "headOid" | "commits">[],
): StaleRef {
  if (entry.revision === undefined) {
    return { revision: null, oid: entry.oid.slice(0, 7), back: null };
  }

  return {
    revision: entry.revision,
    oid: revisions[entry.revision].headOid.slice(0, 7),
    back: newest - entry.revision,
  };
}

function pick(runs: Run[], better: (candidate: Run, best: Run) => boolean): Run {
  return runs.reduce((best, candidate) => (better(candidate, best) ? candidate : best));
}

// A re-run in flight outranks the result it is replacing, so a row never reports a conclusion the
// next run has already moved past.
//
// An exact tie keeps the run already held, and runs arrive with the surviving commits first. So a
// dropped commit never displaces a surviving one that says the same thing.
function beats(candidate: Run, best: Run): boolean {
  if (completed(candidate.run) !== completed(best.run)) {
    return !completed(candidate.run);
  }

  return stamp(candidate.run) > stamp(best.run);
}

function staler(candidate: Run, best: Run): boolean {
  const left = candidate.revision ?? -1;
  const right = best.revision ?? -1;

  if (left !== right) {
    return left > right;
  }

  return stamp(candidate.run) > stamp(best.run);
}

function completed(run: CheckRun): boolean {
  return run.status === "COMPLETED" || run.conclusion !== null;
}

function stamp(run: CheckRun): number {
  return parse(run.completedAt) || parse(run.startedAt);
}

function parse(value: string | null): number {
  if (value === null) {
    return 0;
  }

  const time = Date.parse(value);

  return Number.isNaN(time) ? 0 : time;
}

// Code units rather than locale order, so a row's place does not depend on where the tests run.
function compareNames(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}
