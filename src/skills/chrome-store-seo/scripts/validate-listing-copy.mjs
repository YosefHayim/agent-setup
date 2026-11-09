#!/usr/bin/env node

/**
 * validate-listing-copy.mjs — zero-dep Chrome Web Store listing copy checker.
 *
 * Enforces official hard limits and policy-aligned heuristics from Chrome's
 * listing guide + Keyword Spam policy. Exit codes:
 *   0 = pass (warnings allowed)
 *   1 = policy/limit errors
 *   2 = usage / I/O error
 *
 * Usage:
 *   node validate-listing-copy.mjs --name "…" --summary "…" --description "…"
 *   node validate-listing-copy.mjs --name "…" --summary "…" --description-file ./overview.txt
 *   node validate-listing-copy.mjs --json-file ./listing-copy.json
 *   node validate-listing-copy.mjs --json-file ./listing-copy.json --strict --json
 *
 * --strict treats density warnings as errors.
 */

import { readFileSync } from "node:fs";

const LIMITS = {
  name: 75,
  summary: 132,
  description: 16_000,
};

/** Official summary guidance: avoid superlatives like greatest / fastest. */
// e.g. matches "best", "number one", "#1", "world-class" — not "better" alone
const SUMMARY_SUPERLATIVES = /\b(best|greatest|fastest|number\s*one|#1|top-rated|world.?class)\b/i;

/**
 * Keyword Spam examples include bare lists of brands/keywords without value.
 * Feature bullets with a few commas ("TXT, CSV, or JSON") are normal prose.
 *
 * Flag dump-like lines only: high separator density relative to word count,
 * short tokens, and little sentence punctuation — e.g.
 * "ChatGPT, Gemini, Claude, Copilot, Perplexity, Midjourney, …"
 */
const looksLikeKeywordDump = (line) => {
  // e.g. "- ChatGPT, Gemini, …" or "• brand A, brand B" → strip leading bullet
  const trimmed = line.trim().replace(/^[—\-*•]\s*/, "");
  if (trimmed.length < 24) return false;

  // e.g. "a, b, c, d, e, f" → 5 commas
  const separators = (trimmed.match(/[,|]/g) || []).length;
  if (separators < 5) return false;

  // e.g. "ChatGPT, Gemini · Claude" → tokens split on punctuation/space
  const words = trimmed.split(/[\s,|•·/;]+/).filter(Boolean);
  if (words.length < 6) return false;

  const avgLen = words.reduce((n, w) => n + w.length, 0) / words.length;
  const density = separators / words.length;
  // Real prose: few commas per word. Dumps: almost every token is comma-separated.
  // e.g. ends with "?" or "." → treat as prose, not a dump
  return density >= 0.45 && avgLen <= 14 && !/[.?!]/.test(trimmed);
};

/** Density checks ignore glue words; policy targets *keywords*, not "with". */
const STOPWORDS = new Set(
  `with from that this than then they them their into onto over under about after before while where which when what your yours have been were will just only also more most other such into across using used use each many both some any all and for the are was not but can may does did`.split(
    /\s+/,
  ),
);

const tokenize = (text) =>
  text
    .toLowerCase()
    // e.g. "Fast-AI (v2)!" → "fast-ai  v2 "
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));

const countTokens = (text) => {
  const counts = new Map();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
};

const usage = () =>
  [
    "Chrome Web Store listing copy validator (limits + Keyword Spam heuristics).",
    "",
    "Usage:",
    '  node validate-listing-copy.mjs --name "…" --summary "…" --description "…"',
    "  node validate-listing-copy.mjs --json-file ./listing-copy.json [--strict] [--json]",
    "",
    "Exit 0 = pass, 1 = errors, 2 = usage/IO failure.",
  ].join("\n");

const parseArgs = (argv) => {
  const out = {
    name: "",
    summary: "",
    description: "",
    jsonFile: null,
    descriptionFile: null,
    strict: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
    else if (a === "--name") out.name = argv[++i] || "";
    else if (a === "--summary") out.summary = argv[++i] || "";
    else if (a === "--description") out.description = argv[++i] || "";
    else if (a === "--description-file") out.descriptionFile = argv[++i] || null;
    else if (a === "--json-file") out.jsonFile = argv[++i] || null;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
};

const loadInputs = (args) => {
  let { name, summary, description } = args;
  if (args.jsonFile) {
    const listingDocument = JSON.parse(readFileSync(args.jsonFile, "utf8"));
    name = String(listingDocument.name || name || "");
    summary = String(listingDocument.summary || summary || "");
    description = String(listingDocument.description || description || "");
  }
  if (args.descriptionFile) {
    description = readFileSync(args.descriptionFile, "utf8");
  }
  return { name, summary, description };
};

const validate = ({ name, summary, description }, { strict }) => {
  const errors = [];
  const warnings = [];

  if (!name.trim()) errors.push("name is empty");
  if (!summary.trim()) errors.push("summary is empty");
  if (!description.trim()) errors.push("description is empty");

  if (name.length > LIMITS.name) {
    errors.push(`name is ${name.length} chars (limit ${LIMITS.name})`);
  }
  if (summary.length > LIMITS.summary) {
    errors.push(`summary is ${summary.length} chars (limit ${LIMITS.summary})`);
  }
  if (description.length > LIMITS.description) {
    errors.push(`description is ${description.length} chars (limit ${LIMITS.description})`);
  }

  if (SUMMARY_SUPERLATIVES.test(summary)) {
    errors.push('summary contains a superlative (avoid "best", "greatest", "fastest", "#1" per CWS listing guide)');
  }

  for (const line of description.split(/\r?\n/)) {
    if (looksLikeKeywordDump(line)) {
      errors.push(
        `description line looks like a keyword/brand dump: "${line.slice(0, 80)}${line.length > 80 ? "…" : ""}"`,
      );
    }
  }

  const counts = countTokens(description);
  const over = [...counts.entries()].filter(([, n]) => n > 5).sort((a, b) => b[1] - a[1]);

  for (const [token, n] of over) {
    const msg = `token "${token}" appears ${n} times in description (CWS flags unnatural repeats >5 — review context)`;
    if (strict) errors.push(msg);
    else warnings.push(msg);
  }

  // Mild name stuffing: more than 6 distinct words AND name == summary-ish
  const nameWords = tokenize(name);
  if (nameWords.length >= 10) {
    warnings.push("name has many tokens — prefer brief brand + one job phrase");
  }

  return {
    limits: LIMITS,
    lengths: {
      name: name.length,
      summary: summary.length,
      description: description.length,
    },
    tokenTop: over.slice(0, 12).map(([token, count]) => ({ token, count })),
    errors,
    warnings,
    ok: errors.length === 0,
  };
};

const main = () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(usage());
    process.exit(2);
  }

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  let fields;
  try {
    fields = loadInputs(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  if (!fields.name && !fields.summary && !fields.description && !args.jsonFile) {
    console.error(usage());
    process.exit(2);
  }

  const report = validate(fields, { strict: args.strict });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("CWS listing copy validation");
    console.log(`  name:        ${report.lengths.name}/${LIMITS.name}`);
    console.log(`  summary:     ${report.lengths.summary}/${LIMITS.summary}`);
    console.log(`  description: ${report.lengths.description}/${LIMITS.description}`);
    if (report.tokenTop.length) {
      console.log("  high-frequency tokens:");
      for (const { token, count } of report.tokenTop) {
        console.log(`    ${token}: ${count}`);
      }
    }
    for (const w of report.warnings) console.log(`  WARN  ${w}`);
    for (const e of report.errors) console.log(`  ERROR ${e}`);
    console.log(report.ok ? "PASS" : "FAIL");
  }

  process.exit(report.ok ? 0 : 1);
};

main();
