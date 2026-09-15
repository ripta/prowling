import { fetchPullRequestData } from "./github/query";
import type { PullRequestRef } from "./github/ref";
import type { PullRequest } from "./model";
import { normalizePullRequest } from "./normalize";
import type { Transport } from "./transport";

// The one call a front end makes. Everything behind it is transport-agnostic, so the CLI and the
// extension differ only in the transport they pass.
export async function fetchPullRequest(transport: Transport, ref: PullRequestRef): Promise<PullRequest> {
  const { data, degradations } = await fetchPullRequestData(transport, ref);

  return normalizePullRequest(data, degradations);
}
