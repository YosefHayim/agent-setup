#!/usr/bin/env node
/**
 * check-website-quality — static site auditor (zero-dep, Node only).
 *
 * Reads a project's source and scores seven web best-practice dimensions from the
 * binary markers a grep can see (llms.txt present? _headers/CSP? next/image?
 * robots/sitemap? JSON-LD? next/font?). It does NOT render the site — quality
 * checks (nested <main>, meaningful alt, real vs unsafe-inline CSP, content in the
 * initial HTML) are the agent's semantic pass. Measured Core Web Vitals live in
 * the website-speed-ci skill.
 *
 * Usage:
 *   node audit-site.mjs <project-dir> [--internal] [--strict] [--json]
 *     --internal  dashboards/component libraries behind auth → SEO + agent dims are N/A
 *     --strict    also fail the build when llms.txt / JSON-LD is missing
 *     --json      machine-readable output
 *
 * Exit codes: 0 pass · 1 a critical dimension is missing · 2 bad usage.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// --- pure core: scoring from collected signals ---

const OK = "ok";
const PARTIAL = "partial";
const MISSING = "missing";
const NA = "na";

/**
 * Build one dimension result.
 * @param id stable dimension id (used by the critical-failure gate)
 * @param label human label
 * @param score one of ok | partial | missing | na
 * @param evidence one-line note on what was (not) found
 * @param warn what the agent still has to verify by hand, or null
 * @returns the dimension result record
 */
function dim(id, label, score, evidence, warn) {
  return { id, label, score, evidence, warn: warn || null };
}

function yn(v) {
  return v ? "yes" : "no";
}

function scoreFor(complete, partial) {
  if (complete) return OK;
  if (partial) return PARTIAL;
  return MISSING;
}

function securityEvidence(signals, files) {
  if (files.headers) return "public/_headers present";
  if (signals.headersFn && signals.csp) return "next.config headers() + CSP";
  if (signals.manifestCsp) return "MV3 manifest CSP";
  if (signals.csp) return "CSP string found but wiring unclear";
  return "no CSP/HSTS found";
}

/**
 * Score the seven dimensions from collected signals.
 * @param sig collected markers ({ src, files })
 * @param opts.internal treat SEO + agent dimensions as N/A
 * @returns ordered dimension results
 */
export function scoreDimensions(sig, opts = {}) {
  const internal = Boolean(opts.internal);
  const s = sig.src;
  const f = sig.files;
  const out = [];

  out.push(
    dim(
      "semantic",
      "Semantic HTML & landmarks",
      scoreFor(s.mainTag > 0 && s.landmarks && s.clickableDiv === 0, s.mainTag > 0),
      `${s.mainTag} <main>, landmarks ${yn(s.landmarks)}, ${s.clickableDiv} clickable <div>`,
      "verify exactly one <main> per rendered page (nested <main> is the common bug)",
    ),
  );

  out.push(
    dim(
      "a11y",
      "Accessibility",
      (s.imgTag > 0 && s.altAttr === 0) || !s.labelAssoc ? PARTIAL : OK,
      `${s.imgTag} raw <img>, ${s.altAttr} alt=, label assoc ${yn(s.labelAssoc)}`,
      "confirm alt text is meaningful (not filler) and every input has a linked <label>",
    ),
  );

  const imgOk = s.nextImage || s.modernAsset;
  const fontOk = s.nextFont || s.fontDisplay;
  out.push(
    dim(
      "media",
      "Images & fonts",
      scoreFor(imgOk && fontOk, imgOk || fontOk),
      `next/image ${yn(s.nextImage)}, webp/avif ${yn(s.modernAsset)}, font-display ${yn(fontOk)}`,
      'check explicit width/height on images (CLS) and loading="lazy" below the fold',
    ),
  );

  out.push(
    dim(
      "perf",
      "Performance/CWV",
      s.dynamicImport ? OK : PARTIAL,
      `code-splitting ${s.dynamicImport ? "present" : "not detected"}`,
      "measured LCP/INP/CLS live in the website-speed-ci skill — this is a static hint only",
    ),
  );

  const secOk = (f.headers && (s.csp || s.hsts)) || (s.headersFn && s.csp) || s.manifestCsp;
  const secPartial = f.headers || s.csp || s.headersFn;
  out.push(
    dim(
      "security",
      "Security headers",
      scoreFor(secOk, secPartial),
      securityEvidence(s, f),
      "confirm the CSP is real (not unsafe-inline everywhere) and HSTS + X-Content-Type-Options are set",
    ),
  );

  if (internal) {
    out.push(dim("seo", "SEO metadata", NA, "internal tool — not a public web surface", null));
    out.push(dim("agents", "Machine-readability (agents)", NA, "internal tool — not a public web surface", null));
    return out;
  }

  const seoHits = [s.htmlLang, s.titleMeta, s.descMeta, s.og, f.robots || f.sitemap].filter(Boolean).length;
  out.push(
    dim(
      "seo",
      "SEO metadata",
      scoreFor(seoHits >= 4, seoHits >= 2),
      `lang ${yn(s.htmlLang)}, title ${yn(s.titleMeta)}, desc ${yn(s.descMeta)}, OG ${yn(s.og)}, robots/sitemap ${yn(f.robots || f.sitemap)}`,
      null,
    ),
  );

  out.push(
    dim(
      "agents",
      "Machine-readability (agents)",
      scoreFor(f.llmsTxt && s.jsonLd, f.llmsTxt || s.jsonLd),
      `llms.txt ${yn(f.llmsTxt)}, JSON-LD ${yn(s.jsonLd)}, robots ${yn(f.robots)}`,
      "ensure JSON-LD is server-rendered and content is in the initial HTML (not JS-only)",
    ),
  );

  return out;
}

/**
 * Which dimensions fail the build. Security is always critical; --strict adds
 * machine-readability. N/A never fails.
 * @param dimensionScores scored dimensions
 * @param opts.strict also gate on the agents dimension
 * @returns failing dimension ids
 */
export function criticalFailures(dimensionScores, opts = {}) {
  const critical = new Set(opts.strict ? ["security", "agents"] : ["security"]);
  return dimensionScores.filter((r) => critical.has(r.id) && r.score === MISSING).map((r) => r.id);
}

// --- IO layer ---

const IGNORE = new Set([
  "node_modules",
  "dist",
  "out",
  "build",
  "coverage",
  ".next",
  ".astro",
  ".turbo",
  ".open-next",
  ".vercel",
  ".wrangler",
  ".git",
]);
const SRC_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".astro", ".html", ".css", ".mdx", ".json"]);
const MAX_FILES = 4000;
const MAX_BYTES = 8 * 1024 * 1024;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE.has(entry.name) || (entry.name.startsWith(".") && entry.name.length > 1)) continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function count(re, str) {
  const m = str.match(re);
  return m ? m.length : 0;
}

/**
 * Derive source-level markers from the concatenated source blob.
 * @param blob all scanned source concatenated
 * @param modernAsset whether a .webp/.avif file exists on disk
 * @returns the src signal record
 */
function deriveSrc(blob, modernAsset) {
  return {
    // e.g. "<main>" / "<main class=…>"
    mainTag: count(/<main[\s/>]/g, blob),
    landmarks:
      // e.g. "<nav>", "<header>", or role="navigation"
      /<(header|nav|footer|section|aside|search)[\s/>]/i.test(blob) ||
      /role=["'](banner|navigation|main|contentinfo|complementary|search)["']/i.test(blob),
    // e.g. `<div onClick={…}>` — click handler on non-button
    clickableDiv: count(/<div[^>]*\son(?:Click|MouseDown)=/gi, blob),
    // e.g. "<img src=…>"
    imgTag: count(/<img[\s/>]/gi, blob),
    // e.g. alt="…"
    altAttr: count(/\balt=/g, blob),
    // e.g. htmlFor=, aria-label=, or <label>
    labelAssoc: /htmlFor=|aria-label(?:ledby)?=|<label[\s>]/i.test(blob),
    // e.g. `from "next/image"`
    nextImage: /from\s+["']next\/image["']/.test(blob),
    // e.g. "hero.webp" or "photo.avif"
    modernAsset: modernAsset || /\.(?:webp|avif)\b/i.test(blob),
    // e.g. "next/font"
    nextFont: /next\/font/.test(blob),
    // e.g. "font-display: swap" or display: "swap"
    fontDisplay: /font-display\s*:/i.test(blob) || /display:\s*["']swap["']/.test(blob),
    // e.g. next/dynamic, React.lazy, import(
    dynamicImport: /next\/dynamic|React\.lazy|\blazy\(|\bimport\(/.test(blob),
    // e.g. "Content-Security-Policy"
    csp: /Content-Security-Policy/i.test(blob),
    // e.g. "Strict-Transport-Security"
    hsts: /Strict-Transport-Security/i.test(blob),
    // e.g. `async headers()` or `headers() {`
    headersFn: /async\s+headers\s*\(|\bheaders\s*\(\s*\)\s*\{/.test(blob),
    // e.g. MV3 "content_security_policy"
    manifestCsp: /content_security_policy/i.test(blob),
    // e.g. <html lang="en"> or lang: "en"
    htmlLang: /<html[^>]*\slang=|\blang:\s*["']/.test(blob),
    // e.g. <title>, title: "…", export const metadata, generateMetadata
    titleMeta: /<title[\s>]|title:\s*["'`]|export\s+const\s+metadata|generateMetadata/.test(blob),
    // e.g. description: "…" or name="description"
    descMeta: /description:\s*["'`]|name=["']description["']/.test(blob),
    // e.g. openGraph, property="og:title"
    og: /openGraph|property=["']og:|og:title/.test(blob),
    // e.g. application/ld+json
    jsonLd: /application\/ld\+json/.test(blob),
  };
}

/**
 * Walk a project and collect file-existence + source-level signals.
 * @param root absolute project directory
 * @returns { files, src, filesScanned }
 */
function collectSignals(root) {
  const files = { headers: false, llmsTxt: false, robots: false, sitemap: false, nextConfig: false };
  let blob = "";
  let bytes = 0;
  let scanned = 0;
  let modernAsset = false;

  for (const full of walk(root)) {
    const base = path.basename(full).toLowerCase();
    const ext = path.extname(full).toLowerCase();
    const rel = path.relative(root, full).split(path.sep).join("/").toLowerCase();

    if (base === "_headers") {
      files.headers = true;
      // no extension → not in SRC_EXT; read it so CSP/HSTS detection can see the directives
      try {
        blob += `\n${readFileSync(full, "utf8")}`;
      } catch {
        // unreadable _headers — the presence flag is enough
      }
    }
    if (rel.includes("llms.txt") || base === "llms-full.txt") files.llmsTxt = true;
    // `.txt.ts` / `.xml.ts` catch Astro/Next endpoint files (e.g. `sitemap.xml.ts` → route `/sitemap.xml`).
    if (base === "robots.txt" || base.startsWith("robots.txt.") || base === "robots.ts" || base === "robots.js")
      files.robots = true;
    if (base === "sitemap.xml" || base.startsWith("sitemap.xml.") || base === "sitemap.ts" || base === "sitemap.js")
      files.sitemap = true;
    if (/^next\.config\.(?:js|mjs|ts|cjs)$/.test(base)) files.nextConfig = true;
    if (ext === ".webp" || ext === ".avif") modernAsset = true;

    if (SRC_EXT.has(ext) && scanned < MAX_FILES && bytes < MAX_BYTES) {
      let text = "";
      try {
        text = readFileSync(full, "utf8");
      } catch {
        text = "";
      }
      blob += `\n${text}`;
      bytes += Buffer.byteLength(text);
      scanned += 1;
    }
  }

  return { files, src: deriveSrc(blob, modernAsset), filesScanned: scanned };
}

const MARK = { ok: "✓", partial: "◐", missing: "✗", na: "–" };

/**
 * Run the audit and print a report (or JSON).
 * @param argv process.argv
 * @returns process exit code
 */
function main(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const dirArg = args.find((a) => !a.startsWith("--"));
  if (!dirArg) {
    console.error("usage: node audit-site.mjs <project-dir> [--internal] [--strict] [--json]");
    return 2;
  }
  const root = path.resolve(dirArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`not a directory: ${root}`);
    return 2;
  }

  const internal = flags.has("--internal");
  const strict = flags.has("--strict");
  const sig = collectSignals(root);
  const dimensionScores = scoreDimensions(sig, { internal });
  const failures = criticalFailures(dimensionScores, { strict });

  if (flags.has("--json")) {
    console.log(JSON.stringify({ root, internal, strict, scores: dimensionScores, failures }, null, 2));
    return failures.length ? 1 : 0;
  }

  console.log(`\ncheck-website-quality — ${path.basename(root)}${internal ? " (internal)" : ""}`);
  console.log(`scanned ${sig.filesScanned} source files\n`);
  for (const r of dimensionScores) {
    console.log(`${MARK[r.score]} ${r.label.padEnd(30)} ${r.evidence}`);
    if (r.warn && r.score !== NA) console.log(`   ⚠ ${r.warn}`);
  }
  console.log("");
  if (failures.length) {
    console.log(`FAIL — critical gap: ${failures.join(", ")}. See SKILL.md → Fix (reuse before create).`);
  } else {
    console.log("PASS — no critical gaps. Do the agent semantic pass on any ◐ before claiming compliance.");
  }
  return failures.length ? 1 : 0;
}

process.exit(main(process.argv));
