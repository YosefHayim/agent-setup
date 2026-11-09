---
name: website-speed-ci
description: Use when you want website speed checks in CI. It adds Lighthouse budgets to every PR and a real-user speed check after deploy, for Core Web Vitals. Say "Lighthouse CI", "Core Web Vitals", "performance budget", or "my site is slow".
---

# Website speed CI (Core Web Vitals)

Put a **measured performance budget** between a change and production. Three gates, each watching a different truth:

| Layer | Tool | Answers | Runs |
| --- | --- | --- | --- |
| **Lab** | Lighthouse CI (`lhci autorun`) | "Did this PR regress in a controlled test?" | every PR |
| **Field** | Chrome UX Report (CrUX) API | "What do real users actually experience?" | after deploy / weekly |
| **RUM** | `web-vitals` (optional) | "Which element/script caused it, per page?" | in the live app |

The budget numbers are the same everywhere (one SSOT): **LCP ≤ 2.5s · INP ≤ 200ms · CLS ≤ 0.1**, plus FCP ≤ 1.8s, TTFB ≤ 0.8s, Lighthouse performance ≥ 0.90. **Field data comes from the Chrome UX Report (CrUX) API** — Google is retiring CrUX data from PageSpeed Insights, so `run-crux.mjs` reads CrUX directly while PSI stays the lab source. New here? read `TECH-GLOSSARY.md` first; the model is in `CONTEXT.md`.

## Ground rule

**INP is a field-only metric** — it needs a real user interacting, so Lighthouse's lab run can't produce it. In the lab gate we assert **Total Blocking Time (TBT)** as INP's proxy; the true INP comes from the field (PSI/CrUX) and your RUM. Never claim an INP number from a lab run.

## Front door — grill first, then wire (via question-my-plan)

Interview the user one question at a time; **recommend an answer for each**, and if the repo already answers it, explore the repo instead of asking. Walk the tree in order — each answer changes what you write:

1. **Which surfaces do we gate?** → recommend the homepage + the two highest-traffic templates (a listing + a detail page), not every route.
2. **How does the site run for a test?** (`staticDistDir` a built folder · `startServerCommand` a dev server · a deployed **preview URL**) → **auto-detect** from `package.json` + host: Astro/Vite/Next static export → `staticDistDir`; an app server → `startServerCommand`; Cloudflare Pages/Vercel PR previews → preview URL.
3. **Enforce or observe first?** → recommend shipping assertions as `warn` for ~1–2 weeks to learn the baseline, then flip the Core Web Vitals to `error`.
4. **Do we have field data?** (a PSI API key + enough traffic for CrUX) → recommend adding `PSI_API_KEY` as a repo secret; if traffic is thin, CrUX will be `NONE` — lean on lab + your own RUM until it fills.
5. **Wire RUM now?** (web-vitals in the app → which sink: your `/rum` endpoint, GA4, etc.) → recommend yes only if a sink exists; otherwise defer and note it.
6. **Where do results land?** (`temporary-public-storage` PR link vs a self-hosted LHCI server) → recommend `temporary-public-storage` to start.

## Setup workflow

Run once the interview settles. Reuse the shipped `templates/` and `scripts/` — copy and adapt, don't hand-roll:

1. **Detect the stack + run mode** (step 2 above). Confirm the build command and the served URL/dir.
2. **Write `lighthouserc.json`** at repo root from `templates/lighthouserc.json`; set the `collect` block to the detected run mode and keep the Core Web Vitals assertions. Full option map: `reference/lighthouse-ci.md`.
3. **Write the lab workflow** `.github/workflows/lighthouse-ci.yml` from `templates/lighthouse-ci.yml` (checkout → setup-node → `npm ci` → build if present → `npx @lhci/cli autorun`).
4. **Wire the field check** (Lab + Field): copy `scripts/run-crux.mjs` (the durable field source) to `.github/perf/` and add `.github/workflows/field-check.yml` from the template (runs on successful `deployment_status` + weekly cron). Add a `PSI_API_KEY` secret — a Google key with **both** the PageSpeed Insights API and the **Chrome UX Report API** enabled. It reads `templates/budgets.json` and **exits non-zero** when a real-user Core Web Vital is `poor`; "no CrUX record" (low traffic) passes. Also copy `run-pagespeed.mjs` if you want an on-demand lab check via PSI.
5. **(Optional) RUM** — copy `templates/web-vitals.js` into the app entry, point `ENDPOINT` at the sink, `npm i web-vitals`. It uses the **attribution** build so a bad score names its cause. Details: `reference/web-vitals-rum.md`.
6. **Verify** — locally: `npx @lhci/cli autorun` against a build, and `node scripts/run-pagespeed.mjs https://your-url --strategy=mobile` with a key. Show the before/after and the exact files written; get approval before committing.

## Canonical lab budget (`lighthouserc.json`)

```json
{
  "ci": {
    "collect": { "staticDistDir": "./dist", "numberOfRuns": 3 },
    "assert": {
      "preset": "lighthouse:recommended",
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.9 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "total-blocking-time": ["error", { "maxNumericValue": 200 }],
        "first-contentful-paint": ["warn", { "maxNumericValue": 1800 }],
        "server-response-time": ["warn", { "maxNumericValue": 800 }]
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```

Swap `collect` for the run mode: `{ "startServerCommand": "npm run start", "url": ["http://localhost:3000/"] }` or `{ "url": ["https://preview.example.com/"] }`. `total-blocking-time` is the lab stand-in for INP.

## Field check (Chrome UX Report API)

Real-user field data comes from the **CrUX API** — the durable source, since PSI is dropping its CrUX (`loadingExperience`) data. PSI stays useful for the **lab** score.

```bash
# real-user Core Web Vitals (p75) — exits 1 on a "poor" vital, passes if no CrUX record
node scripts/run-crux.mjs https://example.com --form-factor=PHONE --key=$PSI_API_KEY
# lab score (+ legacy PSI field data while it lasts)
node scripts/run-pagespeed.mjs https://example.com --strategy=mobile --key=$PSI_API_KEY
```

`run-crux.mjs` reads each vital's 75th percentile, falls back from the exact URL to the origin, and treats "no CrUX record" (low traffic) as a pass. Endpoints + response shapes: `reference/crux-api.md` (field), `reference/pagespeed-insights.md` (lab).

## Honest scope — what we do NOT wire

- **`mod_pagespeed` / ngx_pagespeed (PageSpeed Module)** — Google archived it (~2021). Do optimization at **build time** (bundler, image pipeline) and at the **CDN edge** instead. Name it, don't install it.
- **Google Hosted Libraries CDN** — browser cache partitioning (~2020) erased the shared-cache win; **self-host/bundle** is faster now (one less third-party DNS+TLS hop).
- **Google Public DNS (8.8.8.8)** — a client-side resolver choice, not a CI gate; the real TTFB lever is a fast CDN/DNS for your own domain.

## Files

- `CONTEXT.md` — the lab/field/RUM model and where each metric is observable
- `TECH-GLOSSARY.md` — every acronym (LCP, INP, CLS, CrUX, RUM, TTFB, …)
- `README.md` — harness setup (API key), script + template catalog, a full example
- `reference/lighthouse-ci.md` — lighthouserc, presets, budgets, `autorun`, GitHub Action
- `reference/pagespeed-insights.md` — PSI v5 endpoint (lab source; PSI field data is deprecating)
- `reference/crux-api.md` — CrUX API endpoint, request/response — the durable field source
- `reference/web-vitals-rum.md` — the RUM snippet, attribution, sending to analytics
- `scripts/run-crux.mjs` — zero-dep CrUX API field checker (p75 real-user vitals) → exits 1 on a poor vital
- `scripts/run-pagespeed.mjs` — zero-dep PSI v5 checker → lab score (+ legacy field), exits 1 on breach
- `templates/` — `lighthouserc.json`, `lighthouse-ci.yml`, `field-check.yml`, `budgets.json`, `web-vitals.js`
