# CONTEXT — Website speed CI

The domain model behind the skill: what we are gating, where each signal is observable, and how the three gates compose. Read `TECH-GLOSSARY.md` for term definitions; this file is the *why* and the *shape*.

## The problem

Performance regresses silently. A new hero image, a third-party script, an unsized embed — none fail a unit test, none throw, and the developer who shipped them is on a fast laptop near the origin. Users on a mid-tier phone three hops away feel it; you find out from analytics weeks later, or from a search-ranking drop. The fix is to make performance a **measured, blocking budget** in the same pipeline that already gates types and tests.

## Three gates, three truths

No single measurement is enough, because "fast" is measured in two different worlds:

```
        change ──▶ PR ──▶ deploy ──▶ real users
                    │        │            │
              [1] LAB     [2] FIELD    [3] RUM
             Lighthouse   CrUX API     web-vitals
             (reproduce)  (Google's    (your own,
                          scoreboard)   per-page)
```

1. **Lab (Lighthouse CI)** — a controlled re-run on every PR. Its job is **catching regressions before merge**: same machine, same throttling, so a score drop is attributable to the diff, not to noise. It cannot see real-user INP (no human interacts) — it asserts **TBT** as the proxy.
2. **Field (Chrome UX Report / CrUX API)** — after deploy, the real-user distribution Google actually uses for ranking. Its job is **the source of truth for how the site really feels**. It lags 28 days and needs traffic, so it confirms trends rather than blocking individual PRs. Google is retiring CrUX data from PageSpeed Insights, so the field check reads the **CrUX API** directly; PSI remains the lab source.
3. **RUM (web-vitals)** — your own field data, collected per page, in real time, with **attribution** (which element caused the LCP, which script blocked the INP). Its job is **fast, granular diagnosis** — the detail CrUX aggregates away.

The gates overlap on purpose: lab catches it early but synthetically; field confirms it truthfully but slowly; RUM explains it precisely. A regression that clears all three is genuinely fixed.

## One budget, asserted everywhere

The thresholds are a single source of truth (`templates/budgets.json`), applied in each gate's native form:

| Vital | Budget | Lab assertion (lighthouserc) | Field (CrUX API) | RUM (web-vitals) |
| --- | --- | --- | --- | --- |
| LCP | ≤ 2500 ms | `largest-contentful-paint` | `largest_contentful_paint` | `onLCP` |
| INP | ≤ 200 ms | `total-blocking-time` (proxy) | `interaction_to_next_paint` | `onINP` |
| CLS | ≤ 0.1 | `cumulative-layout-shift` | `cumulative_layout_shift` | `onCLS` |
| FCP | ≤ 1800 ms | `first-contentful-paint` | `first_contentful_paint` | `onFCP` |
| TTFB | ≤ 800 ms | `server-response-time` | `experimental_time_to_first_byte` | `onTTFB` |
| Score | ≥ 0.90 | `categories:performance` | — (lab only, via PSI) | — |

Change a number once, and every gate moves with it.

## Run modes (auto-detected)

Lighthouse must load the site somehow. The interview picks one and writes it into the `collect` block:

- **`staticDistDir`** — a pre-built static folder (`./dist`, `./build`). Best for Astro, Vite, SvelteKit static, CF Pages output. Fastest, most hermetic.
- **`startServerCommand`** — LHCI boots your server, waits, then tests `url[]`. For app servers (Next.js `start`, a Node server) that render on request.
- **preview URL** — test a deployed PR preview (Cloudflare Pages / Vercel). Measures the *real* edge/CDN, but needs the deploy to finish first (gate on `deployment_status`).

## Boundaries — what this skill does not own

- It **writes CI config and a checker**; it does not fix the site. When a budget fails, the skill reports the offending audits/attribution and hands off — pair with `make-code-readable`/`image-to-code`/manual work to actually reduce LCP or CLS.
- It does **not** wire deprecated tech (`mod_pagespeed`, Hosted Libraries CDN) — see the honest-scope note in `SKILL.md`.
- It targets **GitHub Actions** workflows by default (the repos here use `gh`); the lighthouserc + `run-pagespeed.mjs` are CI-agnostic if another runner is needed.

## Definition of done

- `lighthouserc.json` present, `collect` matches the real run mode, Core Web Vitals asserted.
- Lab workflow green on a PR and posting a report link.
- `run-pagespeed.mjs` runs against the deployed URL with a key and returns a correct pass/fail.
- (If chosen) web-vitals reporting live and landing in the sink.
- The user has seen the before/after and approved the committed files.
