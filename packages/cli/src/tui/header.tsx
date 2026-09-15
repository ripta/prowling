// The state header: what the pull request is waiting on right now, and one row per check.

import { type CheckRow, type PullRequest, rowRank } from "@prowling/core";

import {
  BORDER,
  clamp,
  colorFor,
  glyphFor,
  LABEL_WIDTH,
  NAME_WIDTH_CAP,
  RESULT_WIDTH,
  resultFor,
  type Role,
  staleSuffix,
  usePalette,
} from "./theme";

export type HeaderProps = {
  pullRequest: PullRequest;
  rows: CheckRow[];
  focused: boolean;
  // Rows the check list may take before it scrolls.
  height: number;
  width: number;
};

// Rows the region takes once drawn, border included. The regions below it are laid out against
// what is left, so the arithmetic lives with the component that decides it.
export function headerHeight(pullRequest: PullRequest, rows: CheckRow[], height: number): number {
  const fields = 5 + (pullRequest.degradations.length > 0 ? 1 : 0);

  return BORDER + fields + (rows.length > 0 ? listHeight(rows, height) : 0);
}

function listHeight(rows: CheckRow[], height: number): number {
  return Math.max(1, Math.min(rows.length, height));
}

export function Header({ pullRequest, rows, focused, height, width }: HeaderProps) {
  const palette = usePalette();
  const unresolved = pullRequest.threads.filter((thread) => !thread.isResolved).length;

  return (
    <box
      title=" state "
      style={{
        flexDirection: "column",
        flexShrink: 0,
        border: true,
        borderStyle: "rounded",
        borderColor: focused ? palette.accent : palette.dim,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <Field label="review" value={pullRequest.reviewDecision ?? "no decision"} role={decisionColor(pullRequest)} />
      <Field label="merge" value={mergeText(pullRequest)} role={mergeColor(pullRequest)} />
      <Field
        label="threads"
        value={threadText(unresolved, pullRequest.threads.length)}
        role={unresolved > 0 ? "bad" : "dim"}
      />
      <Field label="waiting" value={reviewerText(pullRequest)} role="text" />
      {pullRequest.degradations.length > 0 && (
        <Field label="" value={`! ${pullRequest.degradations.length} fields could not be read`} role="warn" />
      )}
      <Field label="checks" value={summaryText(rows)} role="dim" />

      {rows.length > 0 && (
        <scrollbox
          focused={focused}
          scrollY
          viewportCulling
          style={{ height: listHeight(rows, height), marginLeft: LABEL_WIDTH }}
        >
          {rows.map((row) => (
            <CheckLine key={row.name} row={row} width={nameWidth(rows, width)} />
          ))}
        </scrollbox>
      )}
    </box>
  );
}

function CheckLine({ row, width }: { row: CheckRow; width: number }) {
  const palette = usePalette();
  const color = palette[colorFor(row)];
  const suffix = staleSuffix(row);

  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={color}>{`${glyphFor(row)} `}</text>
      <text fg={palette.text}>{clamp(row.name, width).padEnd(width + 1)}</text>
      <text fg={color}>{resultFor(row).padEnd(RESULT_WIDTH)}</text>
      {suffix !== "" && <text fg={palette.dim}>{suffix}</text>}
      {row.isRequired && row.kind !== "missing" && <text fg={palette.dim}>{"  required"}</text>}
    </box>
  );
}

function Field({ label, value, role }: { label: string; value: string; role: Role }) {
  const palette = usePalette();

  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={palette.dim}>{label.padEnd(LABEL_WIDTH)}</text>
      <text fg={palette[role]}>{value}</text>
    </box>
  );
}

// The name column fits the longest name it can, and gives the rest of the line to the result and
// the staleness suffix.
function nameWidth(rows: CheckRow[], width: number): number {
  const longest = rows.reduce((widest, row) => Math.max(widest, row.name.length), 0);
  const budget = width - LABEL_WIDTH - RESULT_WIDTH - 24;

  return Math.max(10, Math.min(NAME_WIDTH_CAP, longest, budget));
}

// A count of what the rows say, so a failure scrolled out of view is still announced.
function summaryText(rows: CheckRow[]): string {
  if (rows.length === 0) {
    return "none";
  }

  const counts = [
    { label: "failing", total: rows.filter((row) => rowRank(row) === 0).length },
    { label: "never run", total: rows.filter((row) => row.kind === "missing").length },
    { label: "running", total: rows.filter((row) => row.kind === "pending").length },
    { label: "stale", total: rows.filter((row) => row.kind === "stale" && rowRank(row) !== 0).length },
    // A check that ran and decided not to do anything did not pass, and saying so keeps the
    // passing count honest about what was actually exercised.
    { label: "skipped", total: rows.filter((row) => rowRank(row) === 5).length },
  ].filter((count) => count.total > 0);

  const passing = rows.length - counts.reduce((total, count) => total + count.total, 0);

  if (passing > 0) {
    counts.push({ label: "passing", total: passing });
  }

  return `${rows.length}  ${counts.map((count) => `${count.total} ${count.label}`).join(" · ")}`;
}

function threadText(unresolved: number, total: number): string {
  if (total === 0) {
    return "none";
  }

  return `${unresolved} unresolved of ${total}`;
}

function reviewerText(pullRequest: PullRequest): string {
  const logins = pullRequest.reviewRequests
    .map((request) => request.reviewer)
    .filter((reviewer) => reviewer !== null)
    .map((reviewer) => `@${reviewer.login}`);

  return logins.length === 0 ? "nobody" : logins.join(", ");
}

function mergeText(pullRequest: PullRequest): string {
  return pullRequest.isDraft ? `${pullRequest.mergeable}, draft` : pullRequest.mergeable;
}

function decisionColor(pullRequest: PullRequest): Role {
  switch (pullRequest.reviewDecision) {
    case "APPROVED":
      return "ok";
    case "CHANGES_REQUESTED":
      return "bad";
    case "REVIEW_REQUIRED":
      return "warn";
    default:
      return "dim";
  }
}

function mergeColor(pullRequest: PullRequest): Role {
  switch (pullRequest.mergeable) {
    case "MERGEABLE":
      return "ok";
    case "CONFLICTING":
      return "bad";
    default:
      return "dim";
  }
}
