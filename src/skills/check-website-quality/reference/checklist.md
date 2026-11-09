# Web best-practices checklist (per dimension)

Each dimension: **what good looks like · common gaps · how to check**. The bars are retrieval-first — the numbers trace to `sources.md`, not memory.

## 1. Semantic HTML & landmarks
- **Good:** native elements carry the meaning — `<header>`(banner), `<nav>`, `<main>`, `<aside>`, `<footer>`, `<search>`. Exactly one `<main>` per rendered page. All perceivable content sits inside a landmark. Correct heading order (`h1`→`h6`, no skips). Real `<button>`/`<a>`, not clickable `<div>`s.
- **Common gaps:** `<div>` soup; nested/duplicate `<main>` (often from a shell wrapping a page that also renders `<main>`); `<section>` with no accessible name (then it isn't a landmark — give it `aria-labelledby` a heading); labels that repeat the role (`aria-label="Primary navigation"` → announced "navigation navigation" — use `"Primary"`); too many landmarks (noise — use sparingly, `role="region"` is the last resort).
- **How to check:** scanner counts `<main>` and clickable `<div>`s; then read the shell/layout to confirm one `<main>` per page and that nav/controls aren't trapped inside it.

## 2. Accessibility
- **Good:** every form control has a linked `<label>` (`htmlFor`/wrapping) or `aria-label`; images have meaningful `alt` (empty `alt=""` only when decorative); icon-only buttons have accessible names; ARIA only where no native element fits ("no ARIA is better than bad ARIA"); visible focus; respects `prefers-reduced-motion`; contrast meets WCAG AA (4.5:1 text, 3:1 large).
- **Common gaps:** icon buttons with no name; inputs with a visual label not programmatically tied; `alt` that's filler or missing; redundant/incorrect ARIA roles.
- **How to check:** scanner flags raw `<img>` vs `alt=` counts and whether label association appears; then eyeball meaningfulness. Live: run an axe/Lighthouse a11y pass.

## 3. Images & fonts
- **Good:** AVIF/WebP (SVG for logos/icons); `srcset`+`sizes` or `<picture>` for the right size per viewport; explicit `width`+`height` on every image (reserves space → no CLS); `loading="lazy"` below the fold; `fetchpriority="high"` on the LCP image; `font-display: swap` + preload the key font (self-hosted/subset). Media is 70%+ of most pages' bytes — the biggest lever.
- **Common gaps:** PNG/JPEG where WebP/AVIF would cut 60–70%; no dimensions (CLS); eager-loading offscreen images; web fonts with no `font-display` (invisible-text FOIT).
- **How to check:** scanner detects `next/image`/modern assets/`next/font`/`font-display`; confirm dimensions + lazy/fetchpriority by hand.

## 4. Performance / Core Web Vitals
- **Good (p75):** **LCP ≤ 2.5s · INP ≤ 200ms · CLS ≤ 0.1.** Brotli/gzip on all text; long-cache (`immutable`) hashed assets; route-based code-splitting + tree-shaking to shrink First Load JS; `defer`/`async` scripts; inline critical CSS; `preconnect`/`preload` criticals.
- **Common gaps:** shipping heavy libs eagerly; render-blocking JS/CSS; no compression at the edge.
- **How to check:** scanner notes code-splitting only. **Measured CWV = the `website-speed-ci` skill** (Lighthouse CI lab + CrUX field). INP is field-only — never claim it from a lab run.

## 5. Security headers (defense in depth)
- **Good:** HTTPS everywhere; **CSP** (disable inline JS, set `frame-ancestors`); **HSTS** (`max-age=31536000; includeSubDomains; preload`); `X-Content-Type-Options: nosniff`; `Referrer-Policy`; `Permissions-Policy`; cookies `Secure`+`HttpOnly`+`SameSite`; SRI on CDN scripts; scoped CORS; validate input + encode output.
- **Common gaps:** no CSP/HSTS at all; a CSP that's `unsafe-inline` everywhere (a fig leaf); cookies missing flags.
- **How to check:** scanner looks for `_headers`, a `headers()` block, or an MV3 manifest CSP. Verify the CSP is real. Live: **MDN HTTP Observatory**.

## 6. SEO metadata
- **Good:** `<html lang>`; `<meta viewport>`; unique `<title>` + meta description per page; Open Graph + Twitter card; canonical; `robots.txt`; `sitemap.xml`; hreflang for i18n.
- **Common gaps:** only `<title>`, no description/OG (poor social + AI-overview previews); missing sitemap/robots.
- **How to check:** scanner checks lang/title/description/OG/robots/sitemap markers. Internal tools: N/A.

## 7. Machine-readability for AI agents
- **Good:** **server-rendered** JSON-LD (schema.org) — one `<script type="application/ld+json">` per type, ISO-8601 dates, consistent entity names/URLs; priority order `Organization → Product/Service → BreadcrumbList → FAQPage → Article`. **`llms.txt`** at the web root (concise, llmstxt.org format). Content in the **initial HTML** (not JS-only). Returns `200`, not blocked by robots/login/geo. Google's agent-ready rules: stable layout, `cursor:pointer` on interactives, label↔input, min target size, no ghost overlays intercepting clicks, visible state change on every action.
- **Common gaps:** JSON-LD injected client-side (crawlers may not run JS); no llms.txt even when robots.txt welcomes AI crawlers; content only after hydration; shifting layouts.
- **How to check:** scanner checks `llms.txt` + `application/ld+json`; confirm JSON-LD is in the server HTML and content isn't JS-gated. (Tailwind v4 dropped the default button `cursor:pointer` — add a 3-line `@layer base` rule to recover Google's rule.)

---

## The build checklist (copy-paste)

```
FOUNDATION
[ ] Semantic landmarks; exactly one <main>; correct heading order
[ ] Real <button>/<a>; every input has a linked <label>
[ ] Native element first; ARIA only when none fits (no bad ARIA)
[ ] <html lang>, <meta charset/viewport>, unique <title> + meta description

PERFORMANCE  (LCP ≤2.5s · INP ≤200ms · CLS ≤0.1)
[ ] Brotli/gzip on all text; long-cache hashed assets
[ ] Code-split + tree-shake; defer/async JS; inline critical CSS
[ ] preconnect/preload criticals; font-display:swap
[ ] AVIF/WebP + srcset; width+height on every image; lazy below fold; fetchpriority on LCP

RESPONSIVE
[ ] Mobile-first min-width queries; don't hide content on mobile
[ ] Container queries for components; rem type; coarse-pointer touch targets

SECURITY
[ ] HTTPS; CSP (no inline JS, frame-ancestors); Secure/HttpOnly/SameSite cookies
[ ] Validate input + encode output; SRI on CDN scripts

MACHINE-READABLE (agent-specific)
[ ] Server-rendered JSON-LD (Org→Product→Breadcrumb→FAQ→Article), ISO-8601 dates
[ ] Content in initial HTML; 200; not robots/login/geo-blocked
[ ] llms.txt at root (concise); stable layout, no ghost overlays, visible action feedback
```
