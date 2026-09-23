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
