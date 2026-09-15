// A pull request reference names one pull request on github.com. Two spellings are accepted: the
// page URL, and the short owner/repo#number form. Parsing is pure string work, so it lives in core
// where the extension can reuse it against the page it is opened on.

export type PullRequestRef = {
  owner: string;
  repo: string;
  number: number;
};

export class InvalidPullRequestRefError extends Error {
  constructor(input: string) {
    super(
      `not a pull request reference: ${JSON.stringify(input)}. ` +
        "Expected owner/repo#123 or https://github.com/owner/repo/pull/123",
    );
    this.name = "InvalidPullRequestRefError";
  }
}

// GitHub logins are alphanumeric with interior hyphens. Repository names also allow dots and
// underscores. Anything after the number in the URL form, such as /files or a fragment, is ignored.
const OWNER = "([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)";
const REPO = "([A-Za-z0-9._-]+)";
const NUMBER = "([1-9][0-9]*)";

const SHORT_FORM = new RegExp(`^${OWNER}/${REPO}#${NUMBER}$`);
const URL_FORM = new RegExp(
  `^https?://(?:www\\.)?github\\.com/${OWNER}/${REPO}/pull/${NUMBER}(?:[/?#].*)?$`,
);

export function parsePullRequestRef(input: string): PullRequestRef {
  const trimmed = input.trim();
  const match = SHORT_FORM.exec(trimmed) ?? URL_FORM.exec(trimmed);

  if (match === null) {
    throw new InvalidPullRequestRefError(input);
  }

  const [, owner, repo, number] = match;
  return { owner, repo, number: Number(number) };
}

export function formatPullRequestRef(ref: PullRequestRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}
