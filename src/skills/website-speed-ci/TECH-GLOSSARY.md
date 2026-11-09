# Tech Glossary — Website speed CI

Plain-language definitions for every term this skill uses. If a gate asserts a number, you should be able to explain what it measures.

## The metrics — what a real visitor *feels*

Core Web Vitals boil down to three feelings: **is it showing up?** (loading), **can I use it?** (responsiveness), **does it hold still?** (visual stability).

- **LCP — Largest Contentful Paint** → *loading.* Time until the biggest element in the viewport (hero image, headline block) is painted. "When does the page look loaded?" **Good ≤ 2.5s.**
- **INP — Interaction to Next Paint** → *responsiveness.* Across the whole visit, the lag between a user action (tap/click/keypress) and the screen updating in response. "When I click, how fast does something happen?" **Good ≤ 200ms.** Field-only — a lab run has no user to interact.
  - **FID — First Input Delay** → the *old* metric INP replaced (March 2024). It measured only the *first* interaction, and only the input delay, not the full time-to-paint. INP is stricter and covers the whole session.
- **CLS — Cumulative Layout Shift** → *visual stability.* A unitless sum of how much visible content jumps around unexpectedly (an image loads and shoves text down; you tap the wrong button). **Good ≤ 0.1.**

Two **supporting** metrics (diagnostic, not "Core"):

- **FCP — First Contentful Paint** → time to the *first* pixel of any content. Earlier signal than LCP: "is anything happening at all?" **Good ≤ 1.8s.**
- **TTFB — Time to First Byte** → time from request sent → first response byte back. Mostly **server + network + CDN + DNS**. A slow TTFB drags everything after it. **Good ≤ 0.8s.**
- **TBT — Total Blocking Time** → *lab only.* Total time the main thread was blocked (long tasks) between FCP and interactive. Lighthouse uses it as the **lab proxy for INP** (the lab can't measure INP directly).

## Lab vs Field — two ways to measure the same page

- **Lab data (synthetic)** → one robot runs the page in a controlled box (fixed CPU/network). **Reproducible → perfect for CI regressions**, but it's not your real users. **Lighthouse** produces this.
- **Field data (real users)** → measurements from actual visitors' browsers on their real devices and networks. **The truth of what people experience**, but noisy and slow to accumulate (needs traffic).
- **RUM — Real User Monitoring** → the *technique* of collecting field data yourself: a small JS snippet records each real session and ships it to your analytics. "Field data" is the data; "RUM" is how you gather it. The **web-vitals** library is a RUM tool.
- **CrUX — Chrome User Experience Report** → Google's *public* field dataset, aggregated from real opted-in Chrome users across millions of sites. It's RUM that **Google collects for you**, and the field data Google uses for search ranking. Catch: it's a **28-day rolling average** and only exists for sites with enough traffic — authoritative but *slow to react*. Your own web-vitals RUM is faster and per-page; CrUX is the "official scoreboard." Query it programmatically via the **CrUX API** (`chromeuxreport.googleapis.com`); Google is removing CrUX data from the PageSpeed Insights API, so field checks should hit CrUX directly.

## The tools (and which linked resource is which)

- **Lighthouse** → Google's open-source audit engine (also in Chrome DevTools). Loads a page in a lab env and scores Performance / Accessibility / Best-Practices / SEO 0–100 with fix advice.
- **Lighthouse CI (LHCI)** → the wrapper that runs Lighthouse *in your pipeline* several times and **asserts the results against budgets** — fail the PR if performance drops. `lhci autorun` = collect → assert → upload. Your **lab gate**.
- **PSI — PageSpeed Insights** → Google's tool + API that runs Lighthouse (lab) **and** (for now) shows CrUX (field) for a URL, together. The v5 `runPagespeed` REST endpoint scripts that check. Free; an API `key` raises rate limits. Your **lab source** — its CrUX field data is being retired (see CrUX), so gate field data on the CrUX API.
- **web-vitals** → the tiny official JS library you drop in to measure LCP/INP/CLS/FCP/TTFB in real users' browsers and send them to analytics. Its `attribution` build also names *what* caused a bad score (which element, which script). Your **RUM**.

## CI / budget vocabulary

- **Performance budget** → a hard limit you commit to (LCP ≤ 2.5s, JS bundle ≤ 200KB). CI fails when a change blows it.
- **Assertion** → one rule in `lighthouserc.json`: `"categories:performance": ["error", { "minScore": 0.9 }]` = "perf score ≥ 0.9 or fail." `minScore` is the 0–1 category score; `maxNumericValue` caps a specific metric in ms or bytes.
- **staticDistDir / startServerCommand** → how LHCI gets your site *running* to test it: point at a built static folder, boot a dev server, or hit a live URL.
- **`temporary-public-storage`** → LHCI upload target that posts each run to a short-lived public report link (easy start); the alternative is a self-hosted LHCI server for history.

## Infra + legacy (why two linked resources are *not* wired)

- **DNS** → the lookup turning `yoursite.com` into an IP — the first step of every request. Slow DNS = slow TTFB.
- **Google Public DNS (8.8.8.8)** → Google's fast free resolver. A client/infra choice, not a CI gate. Your real lever is a fast **CDN + DNS** for your own domain.
- **CDN — Content Delivery Network** → servers near your users that cache and serve content, cutting TTFB and transfer time (e.g. Cloudflare Pages).
- **PageSpeed Module (`mod_pagespeed` / `ngx_pagespeed`)** → an Apache/Nginx module that auto-rewrote pages at serve time (minify, inline CSS, optimize images). Useful ~2015, **archived by Google ~2021.** Modern stacks do this at **build time** + the **CDN edge** — named here so you know why we skip it.
- **Google Hosted Libraries** → a Google CDN serving shared copies of jQuery et al. The old win was a *shared* cross-site browser cache — but browsers **partitioned that cache (~2020)** for privacy, erasing the benefit. **Self-host/bundle** is now faster and more private.

## Cheat sheet

| Metric | Feels like | Good | Where measured |
| --- | --- | --- | --- |
| **LCP** | page looks loaded | ≤ 2.5s | lab + field |
| **INP** | clicks respond fast | ≤ 200ms | field only (lab: TBT) |
| **CLS** | nothing jumps around | ≤ 0.1 | lab + field |
| FCP | first pixel appears | ≤ 1.8s | lab + field |
| TTFB | server answers fast | ≤ 0.8s | lab + field |
