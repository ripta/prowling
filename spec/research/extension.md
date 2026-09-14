# Chrome Extension Research

Research question:

> Can Chrome extensions serve a custom HTML page and perform HTTPS fetch calls?
> For example, I want to write a Chrome extension that serves a different
> GitHub PR page, because I want to experiment with alternate layouts. That is,
> the extension does *not* just do DOM manipulation on an existing page. I want
> to serve a completely new HTML page that calls to the GitHub REST or GraphQL
> API for structured data, and displays it in a particular way.

## Result

Yes, on both counts. This is a well-supported pattern in Manifest V3. The
pieces:

**1. Serving your own page.** Any HTML file bundled in the extension is
reachable at `chrome-extension://<id>/pr.html`. The question is how a user
lands on it when they navigate to `github.com/o/r/pull/123`. Options:

| Mechanism | How it works | Latency / flash | Catches GitHub's in-app (Turbo) navigations? | Notes |
|---|---|---|---|---|
| `declarativeNetRequest` redirect rule | Rule with `regexFilter` on the PR URL, `action.type: "redirect"`, `resourceTypes: ["main_frame"]` | None; request never hits GitHub | No — Turbo fetches are `xmlhttprequest`, and redirecting those breaks GitHub | Cleanest. Needs `declarativeNetRequest` (or `declarativeNetRequestWithHostAccess`) + `host_permissions` for `https://github.com/*`. Target page must be listed in `web_accessible_resources` with `matches: ["https://github.com/*"]`. |
| `webNavigation.onBeforeNavigate` / `onHistoryStateUpdated` → `chrome.tabs.update({url})` | Service worker watches navigations, swaps the tab URL | Brief flash of the real page | Yes (`onHistoryStateUpdated` fires on pushState) | Good complement to DNR for the SPA case. Needs `webNavigation` + `tabs`. |
| Content script that `location.replace()`s | Runs at `document_start`, redirects immediately | Small flash | Yes if you also hook pushState | Simplest to write, least clean. |
| `chrome_url_overrides` | — | — | — | Only `newtab`, `bookmarks`, `history`. Not applicable. |
| Action button / omnibox keyword | User clicks or types `pr 123` | n/a | n/a | Good for a "view this PR in my layout" escape hatch rather than automatic takeover. |

In practice: DNR for full-page loads, plus `onHistoryStateUpdated` for when the
user clicks a PR link inside GitHub.

Two DNR gotchas:

- `extensionPath` doesn't support capture groups, and `regexSubstitution` needs
  an absolute URL that includes your extension ID. Either pin the ID with a
  `key` field in the manifest, or register the rule at runtime via
  `chrome.declarativeNetRequest.updateDynamicRules()` using
  `chrome.runtime.getURL("pr.html")` — I'd do the latter.
- Give yourself a bypass, e.g. a second higher-priority `allow` rule for
  `github.com/.../pull/\d+\?original` or a session rule toggled from the action
  popup, so you can still reach the real page.

```js
// service worker, on install
await chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1, priority: 1,
    condition: {
      regexFilter: "^https://github\\.com/([^/]+)/([^/]+)/pull/(\\d+)/?(?:\\?.*)?$",
      resourceTypes: ["main_frame"],
    },
    action: {
      type: "redirect",
      redirect: { regexSubstitution: chrome.runtime.getURL("pr.html") + "#\\1/\\2/\\3" },
    },
  }],
});
```

**2. HTTPS fetch to the GitHub API.** Extension pages (not content scripts) run
in the extension origin and get CORS-exempt fetch to any host listed in
`host_permissions`. As it happens you don't even need that for GitHub: both
`api.github.com` (REST) and `api.github.com/graphql` send
`Access-Control-Allow-Origin: *` and accept the `Authorization` header via
preflight, so plain `fetch` from `chrome-extension://` works. Adding
`https://api.github.com/*` to `host_permissions` anyway is harmless and
future-proofs against CORS changes.

Auth options:

| Method | Effort | UX | Notes |
|---|---|---|---|
| Fine-grained PAT pasted into options page, stored in `chrome.storage.local` | Trivial | Manual once | Fine for personal experimentation. `storage.local` isn't encrypted; `storage.session` is memory-only. |
| OAuth App via `chrome.identity.launchWebAuthFlow` | Moderate | Proper consent screen | Redirect URI is `https://<id>.chromiumapp.org/`. Token exchange requires a client secret, so either embed it (it's a personal extension) or use a tiny worker. |
| GitHub device flow | Moderate | Type a code | No secret, no redirect URI — arguably the cleanest for extensions. Poll `/login/oauth/access_token`. |
| Reuse the browser's `github.com` session cookies | Low | Invisible | Only works against the HTML site / internal endpoints, not the REST API; fragile. Not recommended. |

Other things you'll hit:

- **CSP.** Extension pages default to `script-src 'self'; object-src 'self'`.
  No inline `<script>`, no CDN scripts — bundle everything (Vite/esbuild with
  React/Solid/whatever). `connect-src` is unrestricted, so fetch is fine.
  Inline styles are OK.
- **Markdown.** GraphQL exposes `bodyHTML` on PRs/comments/reviews, and REST
  has `POST /markdown` (`mode: "gfm"`, `context: "o/r"`) so you don't need to
  render GFM yourself. Sanitize before injecting, or render into a sandboxed
  iframe.
- **Diffs.** REST: `GET /repos/o/r/pulls/N/files` (paginated, patch text per
  file, 3000-file cap) or `Accept: application/vnd.github.diff` on the PR
  endpoint for the raw unified diff. GraphQL has no diff hunks — you'll mix
  both APIs.
- **Rate limits.** 5000 req/hr authenticated REST; GraphQL is point-based (5000
  points/hr) and a single query can pull PR + reviews + threads + commits +
  checks. Use ETags on REST for cheap revalidation.
- **Relative links** in `bodyHTML` (e.g. `#123`, `@user`) come back absolute,
  so they'll navigate to real github.com — which then redirects through your
  DNR rule again. Nice loop, but watch for it.
- **Private repos / SSO.** Fine-grained PATs and OAuth apps both need org
  approval for SAML-enforced orgs.

One question that changes the design: do you want *all* PR views taken over
automatically, or an opt-in view (action button / omnibox) that you toggle
per-PR while iterating on layouts? The latter skips the DNR/Turbo dance
entirely and is what I'd start with for layout experiments.
