# CWS listing SEO — reference

## Official sources (prefer these)

### Chrome Web Store

| Doc | Use |
| --- | --- |
| [Creating a great listing page](https://developer.chrome.com/docs/webstore/best-listing) | Title, summary (132), description, images, promo tiles |
| [Listing requirements / Keyword Spam](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements) | Policy red lines; >5 unnatural keyword repeats |
| [Curation and ranking](https://support.google.com/chrome_webstore/answer/12225786) | Relevancy (name + description), popularity (ratings), quality |
| [Discovery / Featured badge](https://developer.chrome.com/docs/webstore/discovery) | Featured is manual quality/UX, not keyword rank |
| [Store images](https://developer.chrome.com/docs/webstore/images) | Icon + screenshot specs |
| [Name length](https://developer.chrome.com/docs/extensions/whats-new) (2024) | Universal **75** character name cap |

### Google Search / GEO

| Doc | Use |
| --- | --- |
| [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) | Classic site SEO |
| [AI optimization guide (GEO for Google)](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | GEO = SEO; ignore llms.txt/chunking hacks for Google |
| [Helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) | People-first non-commodity pages |
| [Search Console](https://search.google.com/search-console) | Queries, indexing, Generative AI performance reports |
| [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started) | Free lab (+ legacy field) audits |
| [Trends](https://developers.google.com/search/docs/monitor-debug/trends-start) / [Trends API alpha](https://developers.google.com/search/blog/2025/07/trends-api) | Web demand language |
| [Keyword Planner](https://ads.google.com/home/lib/online-campaigns/keyword-planner/) | Web volume estimates (not CWS) |

## Hard limits (CWS)

| Field | Limit | Notes |
| --- | --- | --- |
| Extension **name** | **75** chars | Manifest + store |
| **Summary** (short description) | **132** chars | Homepage, category, search cards |
| **Detailed description** (Overview) | **16,000** chars | Plain text; no Markdown rendering |
| Screenshots | 1280×800 or 640×400 | Full-bleed, square corners |
| Small promo tile | 440×280 | Search / category surfaces |
| Marquee | 1400×560 | Homepage carousel if featured |

## Ranking model (honest)

```text
Relevancy (name + description match to query)
  × Quality / editorial (Featured path, UX, policy)
  × Popularity (rating count + average)
  × Usage quality (installs vs uninstalls, engagement over time)
```

Copy only moves **relevancy** and **conversion**. Ratings and retention often dominate over long horizons.

## Copy patterns

### Name

```text
[Brand] – [primary job]
```

Do: brief, unique, function clear.  
Don’t: keyword stuffing, “best free AI …”.

### Summary

Front-load the job in the first ~60 characters (truncation risk in tight UI). One primary outcome + platforms if they fit.

### Overview skeleton

1. Opening paragraph (who + what + where it runs)  
2. Feature sections (short headings + bullets)  
3. Who it’s for  
4. Pricing (if truthful and stable)  
5. Supported platforms (sentences or short bullets with real URLs — not a 40-brand dump)  
6. Trust / not affiliated / privacy  

## Keyword Spam heuristics (script + human)

The validator flags, it does not replace judgment:

- Any token (length ≥4) appearing **>5** times in Overview → **warn** (policy threshold for *unnatural* repetition)
- Lines that look like bare keyword dumps (comma-separated brand lists) → **error**
- Superlatives in summary: best, greatest, fastest, #1 → **error**
- Empty / over-limit fields → **error**

Natural technical nouns (“prompt” in a prompt-queue product) can legitimately exceed 5; reduce density when bullets become “prompt prompt prompt”. Prefer pronouns and section context.

## Automation map

### Fully automatable today

- Limit checks, superlative ban, rough density, list-spam patterns → `validate-listing-copy.mjs`
- Site performance → PSI API / Lighthouse (see agent-setup `website-speed-ci`)
- Post-publish site queries → Search Console API (property must be verified)

### Semi-automated (agent + browser)

- CWS search for seed terms; scrape visible titles/summaries of top results
- Diff competitor opening paragraphs for shared language (do not copy)

### Not automatable with official free APIs

- CWS impression share / keyword volume
- “Will this rank #1 for X?”
- Buying or faking ratings
- Guaranteed Featured badge

## GEO (owned web properties)

Google’s official stance: optimizing for AI Overviews / AI Mode **is still SEO**. Focus on:

1. Unique, expert, people-first pages (not commodity tip lists)  
2. Clear structure (headings humans use)  
3. Crawlable HTML, good page experience  
4. Measure with Search Console Generative AI reports  

Ignore for Google ranking: `llms.txt`, AI-only micro-chunks, inauthentic mention campaigns.

Extension store pages are **not** fully under your HTML control — put GEO energy into **homepage + docs + authentic third-party coverage**.

## Repo integration patterns

### This monorepo style (`extensions/<slug>/`)

| Field | Typical SSOT |
| --- | --- |
| Store title | `wxt.config.ts` → `STORE_TITLE` |
| Short description | `package.json` → `description` (and/or locale messages) |
| Overview | `cws-listing.ts` → `listing.description` |
| Category / URLs | `cws-listing.ts` |

Push only via explicit CWS verbs (`pnpm cws update-listing <slug>`). Preview with `pnpm cws preview-listing` when available.

### Generic

| Field | Where |
| --- | --- |
| name | `manifest.json` / dashboard |
| description | manifest short + dashboard long description |

## Example research log (agent output shape)

```md
## Seeds
- bulk prompt queue
- chatgpt batch prompts
- gemini queue extension

## CWS observations
| Seed | Top title patterns | Shared summary words |
| --- | --- | --- |
| … | … | … |

## Draft
Name: …
Summary: …
Overview: (link or excerpt)

## Validator
exit 0 / warnings: …
```
