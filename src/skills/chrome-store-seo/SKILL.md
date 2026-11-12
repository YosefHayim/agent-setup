---
name: chrome-store-seo
description: Use when you want more people to find your Chrome extension. It improves the store name, summary, and description, and the landing page, using Google's official rules. Say "Chrome Web Store SEO", "store listing", or "keywords for my extension".
effort: high
---

# Chrome Store SEO (+ GEO)

Maximize **discovery and conversion** for a Chrome extension listing without keyword spam. Work in two surfaces:

| Surface | Goal | Primary levers |
| --- | --- | --- |
| **CWS listing** | Store search + category + Featured path | Name, summary, Overview, category, assets, ratings, retention |
| **Marketing site / docs** | Google Search + AI Overviews / AI Mode | Helpful unique content, crawlability, Search Console |

Official ranking signals (CWS): **relevancy (name + description)**, **popularity (rating count + average)**, **quality/UX**, and **usage** (e.g. installs vs uninstalls). See [REFERENCE.md](REFERENCE.md).

## Automated vs manual (do not fake APIs)

### Prefer automate (scripts / free Google APIs)

| Task | How |
| --- | --- |
| Character limits + spam heuristics | `node scripts/validate-listing-copy.mjs` |
| Name ≤75, summary ≤132, description ≤16k | same script |
| Superlatives / brand-dump / >5 keyword repeats | same script (policy heuristics) |
| Marketing-site lab performance | PageSpeed Insights API / Lighthouse (`website-speed-ci` skill) |
| Site query + AI Overview visibility | Search Console UI / Search Console API (after verify) |
| Demand language (web, not CWS) | Google Trends UI / Trends API alpha; Keyword Planner (Ads) |

### Must stay manual or agent-browser research

| Task | Why |
| --- | --- |
| **CWS keyword volume** | No official free CWS keyword API |
| CWS autocomplete + top-10 competitor titles/summaries | Store is JS-heavy; agent/browser research is the reliable path |
| Judging natural language vs stuffing | Policy is qualitative |
| Featured badge readiness | Human product/UX bar, not copy-only |
| Authentic ratings / retention | Product + support, not metadata hacks |
| GEO “mentions” / `llms.txt` magic | Google: ignore for Search; still classic SEO |

There is **no official free Google API that ranks or keyword-volumes the Chrome Web Store**. Do not invent one.

## Workflow

1. **Load sources of truth** for the extension
   - Title: `STORE_TITLE` / manifest `name` / listing name field
   - Summary: package short description / manifest description (≤132)
   - Overview: `cws-listing.ts` `listing.description` (or dashboard long description)
   - Homepage URL, category, screenshots/icons
2. **Research seeds (manual / browser)** — 5–15 problem phrases users would type in the store (`bulk prompts`, `chatgpt queue`, …). For each seed, capture autocomplete + top titles/summaries. Cluster into primary job + platforms + jobs-to-be-done.
3. **Draft copy**
   - **Name (≤75):** `[Brand] – [primary job in plain language]` — no stuffing
   - **Summary (≤132):** value-first; primary job + 1–2 platforms/outcomes
   - **Overview (≤16k):** overview paragraph → feature sections → audience → trust/privacy. Keywords **in sentences**, never brand/location lists
4. **Validate**

   ```bash
   node scripts/validate-listing-copy.mjs \
     --name "…" --summary "…" --description-file ./overview.txt
   # or JSON:
   node scripts/validate-listing-copy.mjs --json-file ./listing-copy.json
   ```

5. **Apply** to the repo SSOT (`cws-listing.ts`, `STORE_TITLE`, package `description`). Do **not** push to CWS unless the user asks.
6. **GEO (owned site only)** — unique how-to / workflow content, FAQ in human language, PSI/Lighthouse health, Search Console Generative AI report. Skip `llms.txt` as a ranking strategy for Google.
7. **Report** before/after + policy checklist + which steps were automated vs researched.

## Hard policy red lines (Chrome)

From CWS **Keyword Spam** / listing requirements:

- No irrelevant or excessive keywords
- No bare lists of sites / brands / keywords without value
- No lists of regional locations
- No unnatural repetition of the **same** keyword more than **5** times
- No unattributed testimonials in the description
- No superlatives like “best/greatest/fastest” in the summary (official listing guide)

When unsure, cut keywords — suspension risk beats rank fantasy.

## Field checklist

- [ ] Name ≤75, clear, unique, not stuffed
- [ ] Summary ≤132, front-loads value, no competitor names
- [ ] Overview: paragraph + scannable sections; keywords contextual
- [ ] `validate-listing-copy.mjs` exits 0 (or warnings accepted consciously)
- [ ] Category accurate
- [ ] Screenshots/icons match current product
- [ ] Homepage + support URLs real
- [ ] Marketing site (if any): GSC verified; PSI checked
- [ ] No CWS push as a side effect of unrelated work

## Files

- [REFERENCE.md](REFERENCE.md) — official links, limits, ranking, GEO, tool stack
- [scripts/validate-listing-copy.mjs](scripts/validate-listing-copy.mjs) — zero-dep copy validator
- [templates/listing-copy.example.json](templates/listing-copy.example.json) — input shape for the script
