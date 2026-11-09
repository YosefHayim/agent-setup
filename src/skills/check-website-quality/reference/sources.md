# Authoritative sources

Retrieval-first: cite these when stating a threshold or rule, not pre-training. The foundations (a11y, security, semantic HTML, CWV) are stable; the agent-web protocol layer is early — treat specifics as directional.

## Core standards
- **Core Web Vitals — thresholds & definitions** — <https://web.dev/articles/vitals> — LCP ≤ 2.5s, **INP ≤ 200ms (replaced FID in 2024)**, CLS ≤ 0.1, all at the 75th percentile, mobile + desktop.
- **Build agent-friendly websites (Google, web.dev)** — <https://web.dev/articles/ai-agent-site-ux> — the official 7 agent-ready rules (semantic HTML · stable layout · `cursor:pointer` on interactives · label↔input linking · minimum target size · no ghost overlays · visible state change). *"Everything we suggest to make a site 'agent-ready' also makes sites better for humans."*

## Accessibility & semantic HTML
- **MDN — ARIA** — <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA> — first rule of ARIA (native element first); "no ARIA is better than bad ARIA."
- **MDN — using HTML landmark roles** — <https://developer.mozilla.org/en-US/blog/aria-accessibility-html-landmark-roles/> — one `<main>`; `<section>` needs an accessible name; don't repeat the role in a label.
- **W3C ARIA APG — Landmark Regions** — <https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/> — cover all content in landmarks; use sparingly; `region` as last resort.
- **W3C — WCAG 2.2** — <https://www.w3.org/TR/WCAG22/> — success criteria: contrast (AA 4.5:1 / 3:1 large), keyboard, names, focus.

## Performance & media
- **MDN — Multimedia performance** — <https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/Multimedia> — AVIF/WebP/SVG, `srcset`/`<picture>`, `width`+`height` for CLS, `loading="lazy"`, `fetchpriority`.
- **MDN — Web performance** — <https://developer.mozilla.org/en-US/docs/Web/Performance> — resource hints (`preconnect`/`preload`), render-blocking, caching, `font-display`.

## Security
- **MDN — Web security** — <https://developer.mozilla.org/en-US/docs/Web/Security> — HTTPS/TLS, CSP, cookie flags (`Secure`/`HttpOnly`/`SameSite`), SRI, CORS, input validation + output encoding.
- **MDN HTTP Observatory** — <https://developer.mozilla.org/en-US/observatory> — scan a live site's headers and get a graded report.

## Machine-readability for agents
- **llms.txt** — <https://llmstxt.org/> — the `/llms.txt` format: H1 name, blockquote summary, `##`-delimited link lists, an `Optional` section agents can drop when context is tight.
- **schema.org** — <https://schema.org/> — vocabulary for JSON-LD (Organization, Product, BreadcrumbList, FAQPage, Article).
- **Google — intro to structured data** — <https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data> — JSON-LD preferred; server-render it; validate with the Rich Results Test.
