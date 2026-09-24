# AI Crawler Checker

A dependency-free Node.js web app that checks whether a public website appears accessible to major search and AI crawler signals.

## Run

Requires Node.js 20+.

```bash
npm start
```

Open http://localhost:3000. If that port is occupied, run `PORT=3107 npm start` and open http://localhost:3107.

There is no compilation step or dependency installation: Node serves the app directly.

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

## Bounded request and robots processing

Malformed request targets return 400, and asynchronous route failures are caught at the HTTP boundary. Routing and access checks use the same normalized pathname. Robots wildcards use bounded dynamic programming instead of backtracking regular expressions. Parsing is capped at 500,000 characters, 5,000 lines, 1,000 rules and 1,024 characters per rule; each crawler decision has a 500,000-comparison budget and a 4,096-character path limit. Exceeded limits and unavailable robots policies produce an Unknown result and a review finding, not an allow decision.
