#!/usr/bin/env node

/**
 * run-crux.mjs — zero-dep Chrome UX Report (CrUX) API field checker.
 *
 * Queries the CrUX API for a URL's real-user Core Web Vitals (the 75th
 * percentile Google uses), classifies each against the budget, prints a
 * report, and exits non-zero when a Core Web Vital is "poor". This is the
 * durable field source: Google is discontinuing CrUX field data from the
 * PageSpeed Insights API, so field checks should read from CrUX directly.
 * No dependencies — Node 18+ global fetch only.
 *
 * Unlike a lab run, CrUX reports a real INP (there are real users interacting).
 * A URL with too little traffic has no CrUX record — that is reported as
 * "no field data" and passes (absence of data is not a budget breach).
 *
 * Usage:
 *   node run-crux.mjs <url> [--origin] [--form-factor=PHONE|DESKTOP|TABLET]
 *                          [--key=KEY] [--budgets=FILE] [--json] [--strict]
 *
 * The key may also come from CRUX_API_KEY or PSI_API_KEY (the same Google API
 * key works once the "Chrome UX Report API" is enabled on the project).
 */

import { readFile } from "node:fs/promises";

const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

/** Good-line budget (the "good" upper bound per vital). Override with --budgets. */
const DEFAULT_BUDGETS = {
  lcpMs: 2500,
  inpMs: 200,
  clsScore: 0.1,
  fcpMs: 1800,
  ttfbMs: 800,
};

/**
 * The five vitals we read, each mapped to its CrUX metric key and the standard
 * [good, poor] rating bounds. CrUX returns CLS as a decimal string; the rest
 * are integer milliseconds. `core` vitals can fail the gate.
 */
const METRICS = [
  { id: "LCP", key: "largest_contentful_paint", budget: "lcpMs", good: 2500, poor: 4000, cls: false, core: true },
  { id: "INP", key: "interaction_to_next_paint", budget: "inpMs", good: 200, poor: 500, cls: false, core: true },
  { id: "CLS", key: "cumulative_layout_shift", budget: "clsScore", good: 0.1, poor: 0.25, cls: true, core: true },
  { id: "FCP", key: "first_contentful_paint", budget: "fcpMs", good: 1800, poor: 3000, cls: false, core: false },
  {
    id: "TTFB",
    key: "experimental_time_to_first_byte",
    budget: "ttfbMs",
    good: 800,
    poor: 1800,
    cls: false,
    core: false,
  },
];

function usage() {
  return [
    "Chrome UX Report (CrUX) API field checker — real-user Core Web Vitals.",
    "",
    "Usage:",
    "  node run-crux.mjs <url> [--origin] [--form-factor=PHONE|DESKTOP|TABLET]",
    "                         [--key=KEY] [--budgets=FILE] [--json] [--strict]",
    "",
    "The key may also come from CRUX_API_KEY or PSI_API_KEY.",
    "Exit 0 = within budget or no field data, 1 = budget breached, 2 = request error.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    formFactor: "PHONE",
    key: process.env.CRUX_API_KEY || process.env.PSI_API_KEY,
    origin: false,
    json: false,
    strict: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { ...args, help: true };
    if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--origin") args.origin = true;
    else if (arg.startsWith("--form-factor=")) args.formFactor = arg.slice("--form-factor=".length).toUpperCase();
    else if (arg.startsWith("--key=")) args.key = arg.slice("--key=".length);
    else if (arg.startsWith("--budgets=")) args.budgets = arg.slice("--budgets=".length);
    else if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    else if (!args.url) args.url = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.help && !args.url) throw new Error("A URL is required. Try --help.");
  if (!["PHONE", "DESKTOP", "TABLET"].includes(args.formFactor))
    throw new Error("--form-factor must be PHONE, DESKTOP, or TABLET");
  return args;
}

/** Classify a raw p75 value against [good, poor] bounds. */
function ratingFromValue(value, good, poor) {
  if (value <= good) return "good";
  if (value > poor) return "poor";
  return "needs-improvement";
}

/** Pull the p75 for one metric from a CrUX record, or null if absent. */
function p75Of(metric, cruxMetrics) {
  const percentileText = cruxMetrics?.[metric.key]?.percentiles?.p75;
  if (percentileText === undefined || percentileText === null) return null;
  // CrUX encodes CLS as a 2-decimal string ("0.08"); other metrics are integer ms.
  return metric.cls ? Number.parseFloat(percentileText) : Number(percentileText);
}

function formatValue(metric, value) {
  if (value === null) return "—";
  if (metric.cls) return value.toFixed(2);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function formatDate(date) {
  if (!date) return "?";
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/** Build the evaluation object from a CrUX record. Pure. */
function evaluate(record, budgets, strict) {
  const cruxMetrics = record?.metrics;
  const rows = METRICS.map((metric) => {
    const value = p75Of(metric, cruxMetrics);
    const rating = value === null ? "n/a" : ratingFromValue(value, metric.good, metric.poor);
    const budget = budgets[metric.budget];
    const overBudget = value !== null && value > budget;
    const coreFail = metric.core && rating === "poor";
    const strictFail = strict && metric.core && value !== null && (rating !== "good" || overBudget);
    return { ...metric, value, rating, budget, overBudget, failed: coreFail || strictFail };
  });
  const passed = !rows.some((row) => row.failed);
  return { rows, passed };
}

function renderReport(assessment, meta) {
  const lines = [`Chrome UX Report — ${meta.url} (${meta.formFactor}, ${meta.level}-level)`];
  if (meta.period) lines.push(`Collection period: ${meta.period}`);
  lines.push("", "Real-user Core Web Vitals (p75):");
  for (const row of assessment.rows) {
    let flag = "";
    if (row.failed) flag = "  ✗ FAIL";
    else if (row.rating === "needs-improvement") flag = "  ! warn";
    lines.push(
      `  ${row.id.padEnd(5)} ${formatValue(row, row.value).padEnd(9)} ${row.rating.padEnd(18)} (budget ≤ ${formatValue(row, row.budget)})${flag}`,
    );
  }
  lines.push("", `Verdict: ${assessment.passed ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}

// --- IO layer ---------------------------------------------------------------

async function loadBudgets(file) {
  if (!file) return DEFAULT_BUDGETS;
  const budgetText = await readFile(file, "utf8");
  return { ...DEFAULT_BUDGETS, ...JSON.parse(budgetText) };
}

/**
 * Query one CrUX record. Returns { record } on success, { notFound: true } when
 * CrUX has no data for the key (404), and throws on any other error.
 */
async function queryCrux(target, formFactor, key) {
  const httpReply = await fetch(`${CRUX_ENDPOINT}?key=${key || ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...target, formFactor }),
  });
  const cruxDocument = await httpReply.json().catch(() => null);
  if (httpReply.status === 404) return { notFound: true };
  if (!httpReply.ok) {
    const message = cruxDocument?.error?.message || `${httpReply.status} ${httpReply.statusText}`;
    throw new Error(`CrUX request failed: ${message}`);
  }
  return { record: cruxDocument?.record };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const budgets = await loadBudgets(args.budgets);

  // Prefer the exact URL; fall back to the whole origin when the URL has no
  // CrUX record (the common case for a specific page on a smaller site).
  let level = args.origin ? "origin" : "url";
  let cruxLookup = await queryCrux(args.origin ? { origin: args.url } : { url: args.url }, args.formFactor, args.key);
  if (cruxLookup.notFound && !args.origin) {
    level = "origin";
    cruxLookup = await queryCrux({ origin: args.url }, args.formFactor, args.key);
  }

  if (cruxLookup.notFound) {
    const message = `No CrUX field data for ${args.url} (${args.formFactor}) — not enough real-user traffic yet. Skipping field gate.`;
    console.log(args.json ? JSON.stringify({ url: args.url, noFieldData: true, message }) : message);
    return; // exit 0 — absence of data is not a breach
  }

  const evaluated = evaluate(cruxLookup.record, budgets, args.strict);
  const period = cruxLookup.record?.collectionPeriod;
  const meta = {
    url: args.url,
    formFactor: args.formFactor,
    level,
    period: period ? `${formatDate(period.firstDate)} → ${formatDate(period.lastDate)}` : null,
  };

  if (args.json) {
    console.log(JSON.stringify({ ...meta, ...evaluated }, null, 2));
  } else {
    console.log(renderReport(evaluated, meta));
  }
  if (!evaluated.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
