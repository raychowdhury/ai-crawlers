# AI Crawler Checker

A Node.js web app that checks whether a public website appears accessible to major search and AI crawler signals.

## Run

Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000. If that port is occupied, run `PORT=3107 npm start` and open http://localhost:3107.

There is no compilation step. Run `npm install` once to install the HTML parser used for bounded metadata parsing and safe, targeted file edits; Node serves the app directly.

Enter a public website URL (a bare domain is accepted). The report includes per-crawler rules, HTTP results, priority findings, and a JSON download. While an audit runs, the submit button is disabled to prevent duplicate requests.

## Checks
- robots.txt policy for OAI-SearchBot, GPTBot, ChatGPT-User, Googlebot, Google-Extended, bingbot, ClaudeBot, Claude-SearchBot, PerplexityBot
- live HTTP fetch using dedicated crawler User-Agent where applicable
- meta robots and X-Robots-Tag noindex
- redirects
- sitemap.xml and robots-declared sitemaps
- JSON-LD structured data presence
- heuristic 0-100 AI crawl-readiness score
- SSRF protection for localhost/private IP targets and redirects

## Important limitation
This is an external diagnostic. A successful test does not guarantee that a provider will index, rank, train on, or cite a site. Some providers use additional IP verification, browser execution, proprietary crawl systems, or search indexes.

## Network and abuse protection

- Outbound connections use a validated, pinned public IP while preserving the hostname for HTTPS certificate verification.
- Every redirect is validated. Private, loopback, mapped IPv4, reserved, and selected IPv6 transition ranges are rejected.
- Only standard HTTP/HTTPS ports are supported.
- Each fetch has a 9-second deadline covering DNS, redirects, and the complete response body, with a 1.5 MB response limit and at most five redirects.
- Each server process allows at most 3 active audits, 30 admitted audits per minute globally, and 10 per minute per socket client address. Rejections return HTTP 429 with Retry-After.
- Forwarded client-IP headers are intentionally not trusted. Behind a reverse proxy, visitors may share the per-client allowance. Multiple instances require a shared limiter or an edge-level limit for fleet-wide protection.
- Audit request bodies are limited to 10 KB and 10 seconds.

Run the security regression tests with `npm test`. The app does not execute fetched scripts or call an AI model. Exported reports can contain untrusted website text and must remain untrusted if used in a downstream AI workflow.

## Business fix workspace (early access, separate branch)

Open `/workspace` on a development server. The old prototype route remains a visual experiment. `/workspace` has real server-side GitHub integration code and never labels simulated changes as real changes.

### Current integration support

| Platform | Current capability |
|---|---|
| GitHub | Connect one repository, inspect supported source files, review exact before/after content, approve and create a draft pull request, read back the proposed file, refresh PR status |
| WordPress | Platform-specific developer plan download; no plugin connection or site writes yet |
| Shopify | Platform-specific developer plan download; no OAuth connection or store writes yet |
| Other | Developer plan download |

Supported GitHub changes are deliberately narrow:
- Add one verified, same-origin XML sitemap URL to `robots.txt`, `public/robots.txt`, or `static/robots.txt`. Existing crawler permissions are preserved. This does not generate a sitemap.
- Remove literal `noindex` tokens from generic robots meta tags in the head of static `.html` files. Other directives, script contents and comments are preserved using parse5. Templates and response-header noindex require developer review.

The owner must confirm the repository/file-to-website mapping. The app does not infer or independently prove this mapping. Live crawl results are signals and must be reviewed alongside the exact source diff. No LLM is used to generate or execute changes.

### GitHub setup

1. Create a short-lived **fine-grained** GitHub personal access token for **only the selected repository**. Grant Contents: read/write and Pull requests: read/write (GitHub includes metadata read access). Organization policies may require administrator approval.
2. Enter `owner/repository` and the token in the workspace's password field. Do not put the token in the URL, source code, environment files, or chat.
3. Run a website audit, choose a supported fix and exact source path, and confirm the mapping.
4. Review the before/after contents. Explicit approval creates a new `crawler-fixes/<id>` branch and draft PR. There is no automatic merge or deployment.
5. Review repository CI and the PR on GitHub. Closing an unmerged PR discards the proposal; after merging, use a revert PR to roll it back. After your host deploys, rerun the live audit. The app verifies branch contents, not your deployment.

### Runtime configuration

Development defaults to `http://localhost:<PORT>`. If using another host, set `APP_ORIGIN` to the exact browser origin (no trailing slash).

Public deployment is disabled by default. To opt in on an HTTPS host, set:

```text
ENABLE_FIX_WORKSPACE=true
APP_ORIGIN=https://your-exact-host.example
NODE_ENV=production
```

There are no app-wide GitHub credentials. Each connection uses its owner's supplied scoped token. Cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS. Mutations require exact Origin and a session-specific CSRF token. The workspace has no third-party scripts, analytics or browser credential storage.

Sessions, connection tokens, plans, and recent activity live in one process's memory and expire after 30 minutes. Plans expire after 15 minutes. Disconnect forgets the token; revoking it on GitHub invalidates it everywhere. Server restarts lose sessions. A submitted branch/PR persists in GitHub. If an API write fails ambiguously, the plan is locked against blind resubmission and can be checked against GitHub. Inspect any partial branch before starting again.

This release is intended for a single-instance early-access pilot. Persistent accounts, an encrypted shared session store, GitHub App installation authorization, WordPress plugin integration and Shopify OAuth remain future work. Do not scale to multiple instances without shared sessions and distributed limits.

### Verification

`npm test` includes fake-provider integration tests for approval, tenant isolation, CSRF, plan expiry, stale base branches, safe HTML edits, duplicate submission and ambiguous failures. These tests do not create real GitHub resources. A real repository authorization and write must be validated in an owner-approved sandbox repository before public rollout.

## Bounded request and robots processing

Malformed request targets return 400, and asynchronous route failures are caught at the HTTP boundary. Routing and access checks use the same normalized pathname. Robots wildcards use bounded dynamic programming instead of backtracking regular expressions. Parsing is capped at 500,000 characters, 5,000 lines, 1,000 rules and 1,024 characters per rule; each crawler decision has a 500,000-comparison budget and a 4,096-character path limit. Exceeded limits and unavailable robots policies produce an Unknown result and a review finding, not an allow decision.

HTML metadata is parsed in an isolated worker with a one-second deadline and a memory budget. Incomplete metadata produces an Unknown result. All app responses include a restrictive Content Security Policy, frame blocking, MIME sniffing protection, a no-referrer policy, and HSTS on HTTPS.

Unconnected workspace sessions expire after two idle minutes. At most eight anonymous sessions per socket address and 128 globally are retained; the oldest idle anonymous session is evicted when necessary. Connected and busy sessions are never evicted to admit anonymous visitors. Existing request rate limits still apply.
