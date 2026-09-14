// GitHub's GraphQL endpoint can answer HTTP 200 with data and errors at once. A node the token
// cannot see comes back null, its error lands in the errors array, and everything else succeeds.
// Reading data alone renders a view with silent holes.
//
// A SAML failure is not a hole. The token needs authorizing for the organization, which is one
// specific fix worth naming. So it is fatal and carries the remedy. Every other partial error is
// kept as a degradation, with the path it affects, so a renderer can mark where data is missing.

export type GraphQLError = {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
};

export type Degradation = {
  path: (string | number)[];
  message: string;
};

export type Classified<T> = {
  data: T;
  degradations: Degradation[];
};

export const SAML_REMEDY =
  "Run `gh auth refresh -h github.com`, or authorize the token on the organization's SSO page.";

export class GitHubAuthError extends Error {
  readonly remedy: string;

  constructor(message: string, remedy: string) {
    super(message);
    this.name = "GitHubAuthError";
    this.remedy = remedy;
  }
}

export function classifyErrors(errors: GraphQLError[] | undefined): Degradation[] {
  if (errors === undefined) {
    return [];
  }

  // SAML is the only auth failure measured arriving as a partial error. An invalid token fails the
  // whole request instead, so no second fatal class is classified here until one is observed.
  const saml = errors.find(isSamlFailure);
  if (saml !== undefined) {
    throw new GitHubAuthError(saml.message, SAML_REMEDY);
  }

  return errors.map((error) => ({ path: error.path ?? [], message: error.message }));
}

export function classifyResponse<T>(data: T, errors: GraphQLError[] | undefined): Classified<T> {
  return { data, degradations: classifyErrors(errors) };
}

function isSamlFailure(error: GraphQLError): boolean {
  return Boolean(error.extensions?.saml_failure);
}
