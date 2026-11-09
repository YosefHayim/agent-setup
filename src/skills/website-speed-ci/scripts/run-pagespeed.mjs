#!/usr/bin/env node

/**
 * run-pagespeed.mjs — zero-dep PageSpeed Insights v5 field + lab checker.
 *
 * Calls the public runPagespeed endpoint for a URL, reads the lab score
 * (lighthouseResult) and the real-user CrUX field data (loadingExperience),
 * classifies each Core Web Vital against the budget, prints a report, and
 * exits non-zero when a real-user vital is "poor" or the lab score is below
 * budget. No dependencies — Node 18+ global fetch only.
 *
 * Usage:
 *   node run-pagespeed.mjs <url> [--strategy=mobile|desktop] [--key=KEY]
 *                                [--budgets=FILE] [--json] [--strict]
 */

import { readFile } from "node:fs/promises";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Good-line budget (the "good" upper bound per vital). Override with --budgets. */
const DEFAULT_BUDGETS = {
  lcpMs: 2500,
  inpMs: 200,
  clsScore: 0.1,
  fcpMs: 1800,
  ttfbMs: 800,
  performanceScore: 0.9,
};

/**
 * The five vitals we read, each mapped to its CrUX field key, its Lighthouse
 * lab audit id, its budget key, and the standard [good, poor] rating bounds
 * used when CrUX gives no category. `cls` metrics are unitless (÷100 in CrUX).
 */
const METRICS = [
  {
    id: "LCP",
    field: "LARGEST_CONTENTFUL_PAINT_MS",
    audit: "largest-contentful-paint",
    budget: "lcpMs",
    good: 2500,
    poor: 4000,
    cls: false,
    core: true,
  },
  {
    id: "INP",
    field: "INTERACTION_TO_NEXT_PAINT",
    audit: "total-blocking-time",
    budget: "inpMs",
    good: 200,
    poor: 500,
    cls: false,
    core: true,
  },
  {
    id: "CLS",
    field: "CUMULATIVE_LAYOUT_SHIFT_SCORE",
    audit: "cumulative-layout-shift",
    budget: "clsScore",
    good: 0.1,
    poor: 0.25,
    cls: true,
    core: true,
  },
  {
    id: "FCP",
    field: "FIRST_CONTENTFUL_PAINT_MS",
    audit: "first-contentful-paint",
    budget: "fcpMs",
    good: 1800,
    poor: 3000,
    cls: false,
    core: false,
  },
  {
    id: "TTFB",
    field: "EXPERIMENTAL_TIME_TO_FIRST_BYTE",
    audit: "server-response-time",
    budget: "ttfbMs",
    good: 800,
    poor: 1800,
    cls: false,
    core: false,
  },
];

function usage() {
  return [
    "PageSpeed Insights v5 field + lab checker.",
    "",
    "Usage:",
    "  node run-pagespeed.mjs <url> [--strategy=mobile|desktop] [--key=KEY]",
    "                              [--budgets=FILE] [--json] [--strict]",
    "",
    "The key may also come from the PSI_API_KEY environment variable.",
    "Exit 0 = within budget, 1 = budget breached, 2 = usage/request error.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { strategy: "mobile", key: process.env.PSI_API_KEY, json: false, strict: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { ...args, help: true };
    if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg.startsWith("--strategy=")) args.strategy = arg.slice("--strategy=".length);
    else if (arg.startsWith("--key=")) args.key = arg.slice("--key=".length);
    else if (arg.startsWith("--budgets=")) args.budgets = arg.slice("--budgets=".length);
    else if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    else if (!args.url) args.url = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.help && !args.url) throw new Error("A URL is required. Try --help.");
  if (args.strategy !== "mobile" && args.strategy !== "desktop")
    throw new Error("--strategy must be mobile or desktop");
  return args;
}

/** Map a CrUX bucket (FAST/AVERAGE/SLOW) to a rating, or null if absent. */
function ratingFromCategory(category) {
  if (category === "FAST") return "good";
  if (category === "AVERAGE") return "needs-improvement";
  if (category === "SLOW") return "poor";
  return null;
}

/** Classify a raw value against [good, poor] bounds. */
function ratingFromValue(value, good, poor) {
  if (value <= good) return "good";
  if (value > poor) return "poor";
  return "needs-improvement";
}

/**
 * Resolve one metric from the PSI payload: prefer this-URL field data, then
 * origin field data, then the lab audit. Returns value, rating, and source.
 */
function resolveMetric(metric, urlField, originField, labAudits) {
  const fromField = (experience, source) => {
    const entry = experience?.metrics?.[metric.field];
    if (!entry || typeof entry.percentile !== "number") return null;
    const value = metric.cls ? entry.percentile / 100 : entry.percentile;
    const rating = ratingFromCategory(entry.category) || ratingFromValue(value, metric.good, metric.poor);
    return { value, rating, source };
  };
  const field = fromField(urlField, "field") || fromField(originField, "origin");
  if (field) return field;

  const audit = labAudits?.[metric.audit];
  if (audit && typeof audit.numericValue === "number") {
    const value = metric.cls ? audit.numericValue : Math.round(audit.numericValue);
    // INP has no lab equivalent — total-blocking-time is only a proxy, so we
    // report it but never hard-fail on it.
    return {
      value,
      rating: ratingFromValue(value, metric.good, metric.poor),
      source: "lab",
      proxy: metric.id === "INP",
    };
  }
  return { value: null, rating: "n/a", source: "none" };
}

function formatValue(metric, value) {
  if (value === null) return "—";
  if (metric.cls) return value.toFixed(2);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/** Build the full evaluation object from a PSI response. Pure. */
function evaluate(psiDocument, budgets, strict) {
  const scoreCandidate = psiDocument?.lighthouseResult?.categories?.performance?.score;
  const labScore = scoreCandidate === undefined ? null : scoreCandidate;
  const labAudits = psiDocument?.lighthouseResult?.audits;
  const urlField = psiDocument?.loadingExperience;
  const originField = psiDocument?.originLoadingExperience;

  const rows = METRICS.map((metric) => {
    const resolved = resolveMetric(metric, urlField, originField, labAudits);
    const budget = budgets[metric.budget];
    const overBudget = resolved.value !== null && resolved.value > budget;
    const coreFail = metric.core && resolved.rating === "poor" && !resolved.proxy;
    const strictFail = strict && metric.core && (resolved.rating !== "good" || overBudget) && !resolved.proxy;
    return { ...metric, ...resolved, budget, overBudget, failed: coreFail || strictFail };
  });

  const scoreFailed = labScore !== null && labScore < budgets.performanceScore;
  const passed = !scoreFailed && !rows.some((row) => row.failed);
  let fieldOrigin = "lab-only";
  if (urlField) fieldOrigin = "this-url";
  else if (originField) fieldOrigin = "origin";
  return {
    labScore,
    rows,
    scoreFailed,
    passed,
    fieldOrigin,
  };
}

function renderReport(assessment, meta) {
  const lines = [`PageSpeed Insights — ${meta.url} (${meta.strategy})`, ""];
  const score = assessment.labScore === null ? "n/a" : Math.round(assessment.labScore * 100);
  const scoreMark = assessment.scoreFailed ? "FAIL" : "PASS";
  lines.push(
    `Lab performance score: ${score}  (budget ≥ ${Math.round(meta.budgets.performanceScore * 100)})  ${scoreMark}`,
    "",
  );
  lines.push(`Real-user Core Web Vitals (source: ${assessment.fieldOrigin}):`);
  for (const row of assessment.rows) {
    let flag = "";
    if (row.failed) flag = "  ✗ FAIL";
    else if (row.rating === "needs-improvement") flag = "  ! warn";
    const proxy = row.proxy ? " [lab TBT proxy]" : "";
    const budget = `budget ${row.cls ? "≤ " : "≤ "}${formatValue(row, row.budget)}`;
    lines.push(
      `  ${row.id.padEnd(5)} ${formatValue(row, row.value).padEnd(9)} ${row.rating.padEnd(18)} (${budget})${proxy}${flag}`,
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

async function fetchPsi(url, strategy, key) {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (key) params.set("key", key);
  const httpReply = await fetch(`${PSI_ENDPOINT}?${params.toString()}`);
  const psiDocument = await httpReply.json().catch(() => null);
  if (!httpReply.ok) {
    const message = psiDocument?.error?.message || `${httpReply.status} ${httpReply.statusText}`;
    throw new Error(`PageSpeed request failed: ${message}`);
  }
  return psiDocument;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const budgets = await loadBudgets(args.budgets);
  const psiDocument = await fetchPsi(args.url, args.strategy, args.key);
  const assessment = evaluate(psiDocument, budgets, args.strict);

  if (args.json) {
    console.log(JSON.stringify({ url: args.url, strategy: args.strategy, ...assessment }, null, 2));
  } else {
    console.log(renderReport(assessment, { url: args.url, strategy: args.strategy, budgets }));
  }
  if (!assessment.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
