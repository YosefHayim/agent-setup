# Reference — Lighthouse CI (the lab gate)

Lighthouse CI (`@lhci/cli`) runs Lighthouse in your pipeline, several times, and **asserts** the results against a budget. Source: <https://github.com/GoogleChrome/lighthouse-ci>.

## The one command

```bash
npx --yes @lhci/cli autorun
```

`autorun` runs three phases in order:

- **collect** — start/find the site, run Lighthouse `numberOfRuns` times.
- **assert** — compare against your `assertions` / `preset`; non-zero exit on failure.
- **upload** — publish the report (a public link, or a self-hosted server).

> In `autorun`, flags for the child commands **must** use `=` syntax: `--collect.numberOfRuns=5`, not `--collect.numberOfRuns 5`.

## Config file

LHCI reads the first of: `lighthouserc.js`, `.lighthouserc.cjs`, `lighthouserc.json`, `lighthouserc.yml` (and dotted variants). JSON shape:

```json
{
  "ci": {
    "collect": {},
    "assert": {},
    "upload": {}
  }
}
```

### collect — how the site runs (pick one mode)

```json
{ "collect": { "staticDistDir": "./dist", "numberOfRuns": 3 } }
```
```json
{ "collect": { "startServerCommand": "npm run start", "url": ["http://localhost:3000/"], "numberOfRuns": 3 } }
```
```json
{ "collect": { "url": ["https://preview.example.com/"], "numberOfRuns": 3 } }
```

- `staticDistDir` — LHCI serves a built folder itself (fastest, most hermetic).
- `startServerCommand` + `url` — LHCI boots your server, waits, then tests each URL. Add `startServerReadyPattern` if the server prints a ready line.
- bare `url` — test an already-running/deployed URL (preview).
- `numberOfRuns` default is 3; raise to 5 for a steadier median.
- `settings.skipAudits` / `settings.maxWaitForLoad` tune the run.

### assert — the budget

Start from a preset, then override:

- `lighthouse:all` — every audit must be perfect (strict).
- `lighthouse:recommended` — realistic thresholds; performance-metric audits warn.
- `lighthouse:no-pwa` — recommended minus PWA audits.

```json
{
  "assert": {
    "preset": "lighthouse:recommended",
    "assertions": {
      "categories:performance": ["error", { "minScore": 0.9 }],
      "categories:accessibility": ["error", { "minScore": 1 }],
      "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
      "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
      "total-blocking-time": ["error", { "maxNumericValue": 200 }],
      "first-contentful-paint": ["warn", { "maxNumericValue": 1800 }],
      "speed-index": ["warn", { "maxNumericValue": 3400 }],
      "server-response-time": ["warn", { "maxNumericValue": 800 }],
      "uses-responsive-images": "off"
    }
  }
}
```

Each assertion is `[level, options]`:

- **level** — `"off"` · `"warn"` (log, don't fail) · `"error"` (fail the build).
- **options** — `minScore` (0–1 category/audit score) · `maxNumericValue` (ms for time audits, **bytes** for size audits, unitless for CLS) · `maxLength` (array-count audits).
- **aggregationMethod** — `median` (default) · `optimistic` · `pessimistic` · `median-run`. Use `median` for stable gates.

Audit id ↔ Core Web Vital:

| Vital | Audit id | Note |
| --- | --- | --- |
| LCP | `largest-contentful-paint` | ms |
| INP | `total-blocking-time` | **lab proxy** — true INP is field-only |
| CLS | `cumulative-layout-shift` | unitless |
| FCP | `first-contentful-paint` | ms |
| TTFB | `server-response-time` | ms |

### Resource budgets (bundle size)

```json
{
  "assert": {
    "assertions": {
      "resource-summary:script:size": ["error", { "maxNumericValue": 204800 }],
      "resource-summary:document:size": ["error", { "maxNumericValue": 14336 }],
      "resource-summary:font:count": ["warn", { "maxNumericValue": 2 }]
    }
  }
}
```

Note: **lighthouserc assertions use bytes**, while a standalone `budget.json` uses kilobytes.

### upload — where results go

```json
{ "upload": { "target": "temporary-public-storage" } }
```

- `temporary-public-storage` — auto-expiring public report link; zero setup (start here).
- `lhci` + `serverBaseUrl` + `token` — persistent history on a self-hosted LHCI server.
- `filesystem` — write reports locally only.

## GitHub Actions

Self-contained via the npm CLI (version-pinnable, no third-party action):

```yaml
name: Lighthouse CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build --if-present
      - run: npx --yes @lhci/cli@0.14.x autorun
        env:
          LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
```

Alternative: the `treosh/lighthouse-ci-action` marketplace action wraps the same CLI and handles Chrome — pin its major if you use it. Either way the budget lives in `lighthouserc.json`.

## Environment overrides

Any config key can be overridden with an `LHCI_` env var (yargs-style):

```bash
LHCI_COLLECT__NUMBER_OF_RUNS=5 npx @lhci/cli autorun
```

## Rollout tip

Ship assertions as `warn` for 1–2 weeks to learn the site's real baseline (watch the report links), then promote the Core Web Vitals to `error`. Gating on a number you haven't observed produces flaky red builds and teaches the team to ignore the gate.
