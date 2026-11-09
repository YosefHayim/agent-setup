# In-house exemplars (reuse before create)

The audit that motivated this skill found the two systemic gaps **already solved** elsewhere in the `~/Desktop/Code` workspace. Copy these instead of hand-rolling — the "reuse and extend before creating" stance.

## Security headers → `wedding-digital-invites`
`~/Desktop/Code/wedding-digital-invites/public/_headers` is the gold standard for a static / Cloudflare-Pages site: a full **CSP** with a `script-src` allowlist, **HSTS** (`max-age=31536000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a locked-down `Permissions-Policy`, COOP, and `frame-ancestors 'none'`. Copy it, then tune `script-src`/`connect-src` to your analytics. For a Next.js app, use the `headers()` equivalent in `../templates/security-headers.md`.

> This was the **#1 gap** in the audit — missing on every vybekiit app, autobay (only COOP), email-sender, genshot, and portfolio. Only wedding does it right; extensions get it from the MV3 manifest.

## llms.txt + JSON-LD → vybekiit `apps/landing`
- `~/Desktop/Code/vybekiit/apps/landing/app/llms.txt/route.ts` (+ `llms-full.txt/route.ts`) — a Next.js route handler serving `llms.txt` at the web root, regenerated from real content.
- Its `JsonLd` component injects **server-rendered** schema.org (Organization + WebSite + SoftwareApplication) in the root layout.

This is the pattern to lift into the other public apps that lack it: vybekiit `extensionLandingPage` / `mobileAppLandingPage`, `autobay-fe-be`, `email-sender`, `genshot`, `portfolio`, and `wedding-digital-invites` (which welcomes AI crawlers in robots.txt but ships no llms.txt). Starter: `../templates/llms.txt`.

## Modern images & fonts (already good — copy the pattern)
- **next/image + WebP + `priority` above the fold** — `~/Desktop/Code/email-sender` landing (`LandingHeader`, `ProductScreens`), plus `image.qualities` in its `next.config.ts`.
- **`display: "swap"` on `next/font`** — `~/Desktop/Code/autobay-fe-be/app/layout.tsx`.
- **Astro island discipline** (`client:visible|idle|load` used sparingly) + `inlineStylesheets: "always"` + per-locale woff2 preload — `~/Desktop/Code/wedding-digital-invites`.

## Perf CI gate → the `website-speed-ci` skill
Don't build a Core Web Vitals gate here — use **`website-speed-ci`** (Lighthouse CI lab + CrUX field + web-vitals RUM). `~/Desktop/Code/portfolio` already has `.lighthouseci/` wired as a reference.
