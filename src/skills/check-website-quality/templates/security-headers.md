# Security-header templates

Two ways to ship the same defense-in-depth header set (MDN — Web Security). Pick by host. **Tune `script-src`/`connect-src`** to your real analytics/API origins, then verify on a live URL with the **MDN HTTP Observatory**.

> The `'unsafe-inline'` in `script-src` below is a pragmatic starting point. For a strict CSP, move to per-request **nonces or hashes** and drop `'unsafe-inline'` — that's the single biggest hardening step.

## A. Static / Cloudflare Pages — `public/_headers`
Proven set (mirrors `wedding-digital-invites/public/_headers`):

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
```

## B. Next.js — `next.config` `headers()`
Merge into the existing config (don't clobber a config that already exports `headers()`):

```js
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

// inside your Next config object:
async headers() {
  return [{ source: "/:path*", headers: securityHeaders }];
}
```

## C. Chrome extension (MV3)
Not headers — set CSP in the **manifest** (`wxt.config` / `manifest.json`) and keep `host_permissions` minimal:

```json
"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }
```

## Cookies (wherever you issue them)
Headers don't cover cookies — set the flags at the point a cookie is created:
`Set-Cookie: <name>=<value>; Secure; HttpOnly; SameSite=Lax` (use `SameSite=Strict` for session/auth where cross-site navigation isn't needed).
