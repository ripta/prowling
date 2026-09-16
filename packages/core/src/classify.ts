// What each comment and review is, decided by a list of named rules. Procedural means talking about
// the pull request rather than about the change: a command, a ping, a bot confirming it heard one.
//
// Rules are data. Each signal PRW-001 names is one rule, the first match wins, and the name of the
// rule that matched goes on the model. A misclassification is then one named rule to look at, and a
// new signal is one more entry in the list.
//
// Plain records in, plain data out. The normalizer adapts each item into ClassifyInput as it builds
// it, so this module never sees a wire shape and its tests build inputs by hand.

import type {
  Actor,
  Classification,
  ClassificationKind,
  CommentItem,
  ReviewComment,
  ReviewItem,
  ReviewThread,
  TimelineItem,
} from "./model";

// Words left once the mentions are stripped, at or below which a body is a ping rather than a point
// about the change. A layout of language rather than a fixed rule, tuned against the fixtures.
export const MENTION_PHRASE_WORDS = 4;

// Characters of a body carried into the fixture expectations.
export const SNIPPET_CHARS = 100;

// A login is alphanumeric with hyphens. A team mention adds the org and a slash.
const MENTION = /@[a-z\d][a-z\d-]*(?:\/[a-z\d][a-z\d-]*)?/gi;

const SLASH_COMMAND = /^\/[a-z][a-z\d-]*(?:\s.*)?$/i;

// Openings a bot uses to say it heard a command, or that the run it was asked to start has moved
// on. PRW-001 names known phrasing as the signal, so this is a list of phrasings rather than a
// shape, and it grows as fixtures bring in more bots.
//
// Several of these bots mark a status line with a leading emoji and use the marker itself as the
// verdict. Only the markers meaning accepted, running, or passed are listed. A marker meaning
// trouble is left off deliberately: PRW-001 counts a bot calling out a failure as technical, and
// folding one away is the error here that costs something. bors's broken heart, umbrella, and lock
// all fall through to technical for that reason.
const ACKNOWLEDGEMENTS: readonly RegExp[] = [
  // bors: U+231B hourglass for a run it started, U+1F4CC pushpin for a commit it accepted, and
  // U+2600 sun for a run that passed.
  /^[\u{231B}\u{1F4CC}\u{2600}]/u,
  // craterbot: U+1F44C ok hand, U+1F6A7 construction, and U+1F389 party popper, for an experiment
  // queued, running, and finished.
  /^[\u{1F44C}\u{1F6A7}\u{1F389}]/u,
  // rfcbot: U+1F514 bell, for a proposal entering its final comment period.
  /^\u{1F514}/u,
  // rust-timer marks nothing, and says only where the benchmark run has got to.
  /^(awaiting|queued|finished benchmarking) /i,
];

// Which surface a body came from. A review is the summary a reviewer submits, a comment sits on the
// conversation, and a review-comment is inline on a diff line.
export type Source = "review" | "comment" | "review-comment";

// What a rule reads. The normalizer fills this in from the item it is building.
export type ClassifyInput = {
  source: Source;
  author: Actor | null;
  bodyText: string;
};

export type Rule = {
  name: string;
  kind: ClassificationKind;
  matches(input: ClassifyInput): boolean;
};

export const RULES: readonly Rule[] = [
  // A review submitted with no text decided something and said nothing. The decision is already on
  // the row, and the review's own inline comments carry whatever it had to say.
  {
    name: "empty-body",
    kind: "procedural",
    matches: (input) => input.bodyText.trim() === "",
  },

  // Every line is a command addressed to a bot. A body that mixes a command with prose is not one of
  // these, because the prose is the point.
  {
    name: "slash-command",
    kind: "procedural",
    matches: (input) => {
      const body = lines(input.bodyText);

      return body.length > 0 && body.every((line) => SLASH_COMMAND.test(line));
    },
  },

  // A ping. Strip the mentions and what is left is nothing, or too short to be a point about the
  // change. The command forms that are not slashes land here too, since "@bors r+" is this shape.
  {
    name: "mention-only",
    kind: "procedural",
    matches: (input) => {
      const body = input.bodyText.trim();
      const stripped = body.replace(MENTION, " ");

      return stripped !== body && words(stripped).length <= MENTION_PHRASE_WORDS;
    },
  },

  // Inline on a diff line, so it is about the code by construction. This is what keeps a review
  // bot's line comments out of the two rules below it.
  //
  // It sits above them rather than below because a review bot marks its findings the same way a CI
  // bot marks its status lines. copilot-pull-request-reviewer opens every inline comment with an
  // emoji, and those are the findings themselves.
  {
    name: "review-comment",
    kind: "technical",
    matches: (input) => input.source === "review-comment",
  },

  {
    name: "bot-phrasing",
    kind: "procedural",
    matches: (input) => {
      const first = lines(input.bodyText)[0];

      return first !== undefined && ACKNOWLEDGEMENTS.some((pattern) => pattern.test(first));
    },
  },

  // The account is an app. Weakest of the signals, and last for that reason: GitHub types most of
  // the bots that actually crowd a pull request as User, so on its own this reaches only the few
  // that register as apps.
  //
  // Bot is named rather than everything-but-User. A Mannequin is a person whose account never
  // claimed the comments a migration attributed to them, and folding those away would hide a human.
  {
    name: "bot-author",
    kind: "procedural",
    matches: (input) => input.author?.kind === "Bot",
  },
];

export function classify(input: ClassifyInput): Classification {
  for (const rule of RULES) {
    if (rule.matches(input)) {
      return { kind: rule.kind, rule: rule.name };
    }
  }

  return { kind: "technical", rule: null };
}

export type ClassifiedBody = {
  id: string;
  source: Source;
  // The login, or null where the account is gone.
  author: string | null;
  kind: ClassificationKind;
  rule: string | null;
  // The opening of the body on one line. It is here so the expectations read as a review of the
  // rules rather than as a wall of node ids.
  snippet: string;
};

// PullRequest satisfies this structurally.
export type ClassifiedBodiesInput = {
  timeline: readonly TimelineItem[];
  threads: readonly ReviewThread[];
};

// Every body a rule ran on, in model order: the timeline's reviews and issue comments, then the
// comments on each thread.
//
// The checked-in fixture expectations are generated from this list and compared against it, so what
// the generator writes and what the test reads cannot drift apart.
export function classifiedBodies(input: ClassifiedBodiesInput): ClassifiedBody[] {
  const bodies: ClassifiedBody[] = [];

  for (const item of input.timeline) {
    if (item.kind === "review" || item.kind === "comment") {
      bodies.push(classified(item, item.kind));
    }
  }

  for (const thread of input.threads) {
    for (const comment of thread.comments) {
      bodies.push(classified(comment, "review-comment"));
    }
  }

  return bodies;
}

function classified(item: ReviewItem | CommentItem | ReviewComment, source: Source): ClassifiedBody {
  return {
    id: item.id,
    source,
    author: item.author?.login ?? null,
    kind: item.classification.kind,
    rule: item.classification.rule,
    snippet: snippet(item.bodyText),
  };
}

// One line, so a reader scanning the expectations gets one row per body.
function snippet(bodyText: string): string {
  const collapsed = (lines(bodyText)[0] ?? "").replace(/\s+/g, " ");

  return collapsed.length <= SNIPPET_CHARS ? collapsed : `${collapsed.slice(0, SNIPPET_CHARS - 1)}…`;
}

function lines(bodyText: string): string[] {
  return bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}
