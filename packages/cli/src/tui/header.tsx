// The state header: what the pull request is waiting on right now, and one row per check.

import { type CheckRow, needsAttention, type PullRequest, RANK, rowRank } from "@prowling/core";

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

// How much of the check list is on screen. The list is the only part of this region that grows with
// the pull request, so it is the part that gets to be spent rather than the timeline's rows.
export type ChecksMode = "summary" | "attention" | "all";

export type HeaderProps = {
  pullRequest: PullRequest;
  rows: CheckRow[];
  mode: ChecksMode;
  focused: boolean;
  // Rows the check list may take before it scrolls.
  height: number;
  width: number;
};

// The rows a mode draws. Summary draws none: the count line above the list already says what they
// hold, and the rows the list would take are the rows the timeline needs.
export function visibleRows(rows: CheckRow[], mode: ChecksMode): CheckRow[] {
  if (mode === "summary") {
    return [];
  }

  return mode === "attention" ? rows.filter(needsAttention) : rows;
}

// Summary, then what needs acting on, then everything. The attention state is skipped when nothing
// needs acting on, so a green pull request cycles between the count line and the full list rather
// than through a state that would draw nothing.
export function nextChecksMode(mode: ChecksMode, rows: CheckRow[]): ChecksMode {
  if (mode === "all") {
    return "summary";
  }

  if (mode === "attention") {
    return "all";
  }

  return rows.some(needsAttention) ? "attention" : "all";
}

// Rows the region takes once drawn, border included. The regions below it are laid out against
// what is left, so the arithmetic lives with the component that decides it.
export function headerHeight(pullRequest: PullRequest, rows: CheckRow[], mode: ChecksMode, height: number): number {
  const fields = 5 + (pullRequest.degradations.length > 0 ? 1 : 0);
  const shown = visibleRows(rows, mode);

  return BORDER + fields + (shown.length > 0 ? listHeight(shown, height) : 0);
}

function listHeight(rows: CheckRow[], height: number): number {
  return Math.max(1, Math.min(rows.length, height));
}

export function Header({ pullRequest, rows, mode, focused, height, width }: HeaderProps) {
  const palette = usePalette();
  const unresolved = pullRequest.threads.filter((thread) => !thread.isResolved).length;
  const shown = visibleRows(rows, mode);

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
      <Field label="checks" value={summaryText(rows, mode)} role="dim" />

      {shown.length > 0 && (
        <scrollbox
          focused={focused}
          scrollY
          viewportCulling
          style={{ height: listHeight(shown, height), marginLeft: LABEL_WIDTH }}
        >
          {shown.map((row) => (
            <CheckLine key={row.name} row={row} width={nameWidth(shown, width)} />
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

// A count of what the rows say, so a failure the list is not currently drawing is still announced.
// This line is the whole region in summary mode, which is what lets the list be closed by default.
function summaryText(rows: CheckRow[], mode: ChecksMode): string {
  if (rows.length === 0) {
    return "none";
  }

  const counts = [
    { label: "failing", total: rows.filter((row) => rowRank(row) === RANK.failing).length },
    { label: "never run", total: rows.filter((row) => row.kind === "missing").length },
    { label: "running", total: rows.filter((row) => row.kind === "pending").length },
    { label: "stale", total: rows.filter((row) => row.kind === "stale" && rowRank(row) !== RANK.failing).length },
    // A check that ran and decided not to do anything did not pass, and saying so keeps the
    // passing count honest about what was actually exercised.
    { label: "skipped", total: rows.filter((row) => rowRank(row) === RANK.skipped).length },
  ].filter((count) => count.total > 0);

  const passing = rows.length - counts.reduce((total, count) => total + count.total, 0);

  if (passing > 0) {
    counts.push({ label: "passing", total: passing });
  }

  const shown = mode === "summary" ? "" : `  [${mode}]`;

  return `${rows.length}  ${counts.map((count) => `${count.total} ${count.label}`).join(" · ")}${shown}`;
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
