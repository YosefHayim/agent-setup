---
name: check-website-quality
description: Use when you want to check a website and fix what is wrong — HTML, accessibility, images, speed, security headers, SEO, and AI-readiness. It runs a scanner and gives copy-paste fixes. Say "check my site", "accessibility", "SEO tags", or "security headers". For speed checks in CI, use website-speed-ci.
---

# Check website quality (audit + fix)

One principle drives this skill: **making a site good for AI agents and good for humans is the same work.** Google's own agent guide says it — *"Everything we suggest to make a site 'agent-ready' also makes sites better for humans."* An agent reads a page through the screenshot, the raw DOM, and the **accessibility tree** — exactly what a screen reader, a search crawler, and a performance budget already reward. So this is **one audit**, scored across seven dimensions, each with a copy-paste fix.

> **Perf is delegated.** This skill checks performance at a glance only; the measured Core Web Vitals CI gate (Lighthouse CI lab + CrUX field + web-vitals RUM) is the **`website-speed-ci`** skill — hand off there, don't re-implement it.

## The seven dimensions

| # | Dimension | The bar |
| --- | --- | --- |
| 1 | **Semantic HTML & landmarks** | native elements over `<div>`; exactly one `<main>`; `<section>` needs an accessible name or it isn't a landmark |
| 2 | **Accessibility** | real `<button>`/`<a>`; every input a linked `<label>`; meaningful `alt`; no bad ARIA (native first) |
| 3 | **Images & fonts** | AVIF/WebP + `srcset`; explicit `width`/`height` (kills CLS); `loading="lazy"` below the fold; `font-display: swap` |
| 4 | **Performance/CWV** | LCP ≤2.5s · INP ≤200ms · CLS ≤0.1; code-split heavy libs; brotli; long-cache hashed assets |
| 5 | **Security headers** | HTTPS; CSP (no inline JS, `frame-ancestors`); HSTS; `X-Content-Type-Options`; `Secure`/`HttpOnly`/`SameSite` cookies |
| 6 | **SEO metadata** | `<html lang>`, viewport, unique `<title>` + description, Open Graph, robots + sitemap |
| 7 | **Machine-readability (agents)** | server-rendered JSON-LD (schema.org); `llms.txt` at root; content in the initial HTML; stable layout |

Per-dimension detail + the copy-paste checklist: `reference/checklist.md`. Authoritative sources (cite these, not memory): `reference/sources.md`.

## Audit workflow

1. **Scan (deterministic).** Run the zero-dep scanner over the project — it flags the binary markers (llms.txt present? `_headers`/CSP? `next/image`? robots/sitemap? JSON-LD? `next/font`?) per dimension:
   ```bash
   node scripts/audit-site.mjs <project-dir>             # public site
   node scripts/audit-site.mjs <project-dir> --internal  # internal tool: SEO + agent dims are N/A
   node scripts/audit-site.mjs <project-dir> --strict    # also fail on missing llms.txt/JSON-LD
   ```
   It prints ✓ / ◐ partial / ✗ per dimension and **exits 1** on a critical gap (missing security headers; `--strict` also gates machine-readability) so it can run in CI.
2. **Semantic pass (agent).** A grep can't judge *quality*. Read the flagged files and confirm what the scanner can't: is the `<main>` nested? is `alt` meaningful or filler? is the CSP real, or `unsafe-inline` everywhere? is content in the initial HTML or JS-only? Each ✓/◐ prints a ⚠ telling you what still needs eyes.
3. **Fix — reuse before create.** Two gaps are near-universal, and the fixes already exist in this workspace (`reference/exemplars.md`) — copy them, don't invent:
   - **Security headers** → copy `wedding-digital-invites/public/_headers` (full CSP/HSTS/XFO/Referrer/Permissions) for a static/CF-Pages site; `templates/security-headers.md` has the Next.js `headers()` equivalent.
   - **llms.txt + JSON-LD** → copy vybekiit `apps/landing/app/llms.txt/route.ts` + its `JsonLd` component; `templates/llms.txt` is a starter in the llmstxt.org format.
4. **Report** the before/after per dimension, show the exact files written, and get approval before committing.

## Honest scope

- **Static scan ≠ live audit.** The scanner reads source; it does not render. It can't measure real LCP/CLS (that's `website-speed-ci`) or see runtime-injected DOM. Treat ✓ as "the marker exists," then verify quality by hand.
- **Internal tools** (dashboards, component libraries behind auth) legitimately skip dimensions 6–7 → run `--internal`. They still owe 1–5.
- **Not every project is a website.** CLIs, bots, MCP servers, and RN/Expo apps are out of scope; Chrome-extension UIs owe 1–4 (CSP lives in the MV3 manifest), not 6–7.

## Files

- `scripts/audit-site.mjs` — zero-dep static scanner → per-dimension ✓/◐/✗, exits 1 on a critical gap
- `reference/checklist.md` — per-dimension detail (what good looks like · common gaps · how to check) + the copy-paste build checklist
- `reference/sources.md` — authoritative sources (MDN, web.dev, W3C APG, llmstxt.org) with what each covers
- `reference/exemplars.md` — in-house reference implementations to copy (security headers, llms.txt, next/image, Astro islands)
- `templates/llms.txt` — starter llms.txt (llmstxt.org format)
- `templates/security-headers.md` — `_headers` (CF Pages) + Next.js `headers()` snippets
