#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const MILLISECONDS_PER_SECOND = 1000;

const ORIGIN_LEVEL = "origin";

const RATING_NEEDS_IMPROVEMENT = "needs-improvement";

const RATING_POOR = "poor";

const RATING_GOOD = "good";

const BUDGETS_FLAG_PREFIX = "--budgets=";

const KEY_FLAG_PREFIX = "--key=";

const FORM_FACTOR_FLAG_PREFIX = "--form-factor=";

const PHONE_FORM_FACTOR = "PHONE";

const NEWLINE_CHARACTER = "\n";

const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

const LCP_GOOD_MILLISECONDS = 2500;
const INP_GOOD_MILLISECONDS = 200;
const CLS_GOOD_SCORE = 0.1;
const ONE_POINT_EIGHT_SECONDS_MILLISECONDS = 1800;
const TTFB_GOOD_MILLISECONDS = 800;

const DEFAULT_BUDGETS = {
  lcpMs: LCP_GOOD_MILLISECONDS,
  inpMs: INP_GOOD_MILLISECONDS,
  clsScore: CLS_GOOD_SCORE,
  fcpMs: ONE_POINT_EIGHT_SECONDS_MILLISECONDS,
  ttfbMs: TTFB_GOOD_MILLISECONDS,
};

const METRICS = [
  {
    id: "LCP",
    key: "largest_contentful_paint",
    budget: "lcpMs",
    good: LCP_GOOD_MILLISECONDS,
    poor: 4000,
    cls: false,
    core: true,
  },
  {
    id: "INP",
    key: "interaction_to_next_paint",
    budget: "inpMs",
    good: INP_GOOD_MILLISECONDS,
    poor: 500,
    cls: false,
    core: true,
  },
  {
    id: "CLS",
    key: "cumulative_layout_shift",
    budget: "clsScore",
    good: CLS_GOOD_SCORE,
    poor: 0.25,
    cls: true,
    core: true,
  },
  {
    id: "FCP",
    key: "first_contentful_paint",
    budget: "fcpMs",
    good: ONE_POINT_EIGHT_SECONDS_MILLISECONDS,
    poor: 3000,
    cls: false,
    core: false,
  },
  {
    id: "TTFB",
    key: "experimental_time_to_first_byte",
    budget: "ttfbMs",
    good: TTFB_GOOD_MILLISECONDS,
    poor: ONE_POINT_EIGHT_SECONDS_MILLISECONDS,
    cls: false,
    core: false,
  },
];

const createUsageMessage = () => {
  return [
    "Chrome UX Report (CrUX) API field checker — real-user Core Web Vitals.",
    "",
    "Usage:",
    "  node run-crux.mjs <url> [--origin] [--form-factor=PHONE|DESKTOP|TABLET]",
    "                         [--key=KEY] [--budgets=FILE] [--json] [--strict]",
    "",
    "The key may also come from CRUX_API_KEY or PSI_API_KEY.",
    "Exit 0 = within budget or no field data, 1 = budget breached, 2 = request error.",
  ].join(NEWLINE_CHARACTER);
};

const parseArgumentList = (argv) => {
  const argumentList = {
    formFactor: PHONE_FORM_FACTOR,
    key: process.env.CRUX_API_KEY || process.env.PSI_API_KEY,
    origin: false,
    isMachineReadable: false,
    strict: false,
  };
  for (const arg of argv) {
    const isHelpFlag = arg === "--help" || arg === "-h";
    if (isHelpFlag) return { ...argumentList, help: true };

    const isMachineReadableFlag = arg === "--json";
    if (isMachineReadableFlag) {
      argumentList.isMachineReadable = true;
      continue;
    }

    const isStrictFlag = arg === "--strict";
    if (isStrictFlag) {
      argumentList.strict = true;
      continue;
    }

    const isOriginFlag = arg === "--origin";
    if (isOriginFlag) {
      argumentList.origin = true;
      continue;
    }

    const isFormFactorFlag = arg.startsWith(FORM_FACTOR_FLAG_PREFIX);
    if (isFormFactorFlag) {
      argumentList.formFactor = arg.slice(FORM_FACTOR_FLAG_PREFIX.length).toUpperCase();
      continue;
    }

    const isKeyFlag = arg.startsWith(KEY_FLAG_PREFIX);
    if (isKeyFlag) {
      argumentList.key = arg.slice(KEY_FLAG_PREFIX.length);
      continue;
    }

    const isBudgetsFlag = arg.startsWith(BUDGETS_FLAG_PREFIX);
    if (isBudgetsFlag) {
      argumentList.budgets = arg.slice(BUDGETS_FLAG_PREFIX.length);
      continue;
    }

    const isUnknownFlag = arg.startsWith("--");
    if (isUnknownFlag) throw new Error(`Unknown argument: ${arg}`);

    const isUrlAlreadyGiven = Boolean(argumentList.url);
    if (isUrlAlreadyGiven) throw new Error(`Unexpected argument: ${arg}`);

    argumentList.url = arg;
  }

  const isUrlMissing = !argumentList.url;
  if (isUrlMissing) throw new Error("A URL is required. Try --help.");

  const isFormFactorInvalid = ![PHONE_FORM_FACTOR, "DESKTOP", "TABLET"].includes(argumentList.formFactor);
  if (isFormFactorInvalid) throw new Error("--form-factor must be PHONE, DESKTOP, or TABLET");

  return argumentList;
};

const readRatingFromField = (field, good, poor) => {
  const isFieldGood = field <= good;
  if (isFieldGood) return RATING_GOOD;

  const isFieldPoor = field > poor;
  if (isFieldPoor) return RATING_POOR;

  return RATING_NEEDS_IMPROVEMENT;
};

const readP75 = (metric, cruxMetrics) => {
  const percentileString = cruxMetrics?.[metric.key]?.percentiles?.p75;
  const isPercentileMissing = percentileString == null;
  if (isPercentileMissing) return null;

  // CrUX encodes CLS as a 2-decimal string ("0.08"); other metrics are integer ms.
  const isCumulativeLayoutShift = metric.cls === true;
  return isCumulativeLayoutShift ? Number.parseFloat(percentileString) : Number(percentileString);
};

const createMetricLabel = (metric, metricReading) => {
  const isReadingMissing = metricReading === null;
  if (isReadingMissing) return "—";

  const isCumulativeLayoutShift = metric.cls === true;
  const clsDecimals = 2;

  if (isCumulativeLayoutShift) return metricReading.toFixed(clsDecimals);

  const isOverOneSecond = metricReading >= MILLISECONDS_PER_SECOND;
  return isOverOneSecond
    ? `${(metricReading / MILLISECONDS_PER_SECOND).toFixed(1)} s`
    : `${Math.round(metricReading)} ms`;
};

const createDateStamp = (date) => {
  const isDateMissing = date == null;
  if (isDateMissing) return "?";

  const dateMonthDigits = 2;

  const dayDigits = 2;

  return `${date.year}-${String(date.month).padStart(dateMonthDigits, "0")}-${String(date.day).padStart(dayDigits, "0")}`;
};

const evaluate = (cruxReply, budgets, strict) => {
  const cruxMetrics = cruxReply?.metrics;
  const metricChecks = METRICS.map((metric) => {
    const p75Reading = readP75(metric, cruxMetrics);
    const hasP75Reading = p75Reading !== null;
    const rating = hasP75Reading ? readRatingFromField(p75Reading, metric.good, metric.poor) : "n/a";
    const budget = budgets[metric.budget];
    const overBudget = hasP75Reading && p75Reading > budget;
    const coreFail = metric.core && rating === RATING_POOR;
    const strictFail = strict && metric.core && hasP75Reading && (rating !== RATING_GOOD || overBudget);
    return { ...metric, value: p75Reading, rating, budget, overBudget, failed: coreFail || strictFail };
  });
  const passed = !metricChecks.some((metricCheck) => metricCheck.failed);
  return { rows: metricChecks, passed };
};

const readMetricFlag = (metricCheck) => {
  const isMetricFailed = metricCheck.failed;
  if (isMetricFailed) return "  ✗ FAIL";

  const isMetricNeedingImprovement = metricCheck.rating === RATING_NEEDS_IMPROVEMENT;
  if (isMetricNeedingImprovement) return "  ! warn";

  return "";
};

const createReport = (assessment, meta) => {
  const lines = [`Chrome UX Report — ${meta.url} (${meta.formFactor}, ${meta.level}-level)`];

  const hasCollectionPeriod = meta.period != null;
  if (hasCollectionPeriod) lines.push(`Collection period: ${meta.period}`);

  lines.push("", "Real-user Core Web Vitals (p75):");
  for (const metricCheck of assessment.rows) {
    const flag = readMetricFlag(metricCheck);
    const metricRatingColumnWidth = 18;

    const metricLabelColumnWidth = 9;

    const metricIdColumnWidth = 5;

    lines.push(
      `  ${metricCheck.id.padEnd(metricIdColumnWidth)} ${createMetricLabel(metricCheck, metricCheck.value).padEnd(metricLabelColumnWidth)} ${metricCheck.rating.padEnd(metricRatingColumnWidth)} (budget ≤ ${createMetricLabel(metricCheck, metricCheck.budget)})${flag}`,
    );
  }

  const isPassed = assessment.passed;
  lines.push("", `Verdict: ${isPassed ? "PASS" : "FAIL"}`);
  return lines.join(NEWLINE_CHARACTER);
};

const loadBudgets = async (budgetsFile) => {
  const isBudgetsFileMissing = !budgetsFile;
  if (isBudgetsFileMissing) return DEFAULT_BUDGETS;

  const budgetsDocument = await readFile(budgetsFile, "utf8");
  return { ...DEFAULT_BUDGETS, ...JSON.parse(budgetsDocument) };
};

const readCruxErrorMessage = async (httpReply) => {
  const statusMessage = `${httpReply.status} ${httpReply.statusText}`;
  const replyDocument = await httpReply.text();

  try {
    const errorDocument = JSON.parse(replyDocument);
    return errorDocument?.error?.message || statusMessage;
  } catch {
    // A reply that is not JSON still reports the HTTP status.
    return statusMessage;
  }
};

// Returns { record } on success, { notFound: true } when CrUX has no data for the target (404).
const queryCrux = async (target, formFactor, key) => {
  const httpReply = await fetch(`${CRUX_ENDPOINT}?key=${key || ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...target, formFactor }),
  });

  const notFoundStatus = 404;

  const isNotFound = httpReply.status === notFoundStatus;
  if (isNotFound) return { notFound: true };

  const isReplyOk = httpReply.ok;
  if (isReplyOk) {
    const cruxDocument = await httpReply.json();
    return { record: cruxDocument?.record };
  }

  const errorMessage = await readCruxErrorMessage(httpReply);
  throw new Error(`CrUX request failed: ${errorMessage}`);
};

// Prefer the exact URL; fall back to the whole origin when the URL has no CrUX record.
const queryCruxWithOriginFallback = async (argumentList) => {
  const isOriginRequested = argumentList.origin;
  const requestedTarget = isOriginRequested ? { origin: argumentList.url } : { url: argumentList.url };
  const requestedLookup = await queryCrux(requestedTarget, argumentList.formFactor, argumentList.key);

  const isUrlLookupMissing = requestedLookup.notFound && !isOriginRequested;
  if (!isUrlLookupMissing) {
    const requestedLevel = isOriginRequested ? ORIGIN_LEVEL : "url";
    return { level: requestedLevel, cruxLookup: requestedLookup };
  }

  const originLookup = await queryCrux({ origin: argumentList.url }, argumentList.formFactor, argumentList.key);
  return { level: ORIGIN_LEVEL, cruxLookup: originLookup };
};

const runCruxCommand = async () => {
  const firstArgumentIndex = 2;

  const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
  const isHelpRequested = Boolean(argumentList.help);
  if (isHelpRequested) {
    console.log(createUsageMessage());
    return;
  }

  const budgets = await loadBudgets(argumentList.budgets);
  const { level, cruxLookup } = await queryCruxWithOriginFallback(argumentList);

  const isCruxFieldMissing = cruxLookup.notFound;
  if (isCruxFieldMissing) {
    const message = `No CrUX field data for ${argumentList.url} (${argumentList.formFactor}) — not enough real-user traffic yet. Skipping field gate.`;
    const isMachineReadable = argumentList.isMachineReadable;
    console.log(isMachineReadable ? JSON.stringify({ url: argumentList.url, noFieldData: true, message }) : message);
    return; // exit 0 — absence of data is not a breach
  }

  const evaluated = evaluate(cruxLookup.record, budgets, argumentList.strict);
  const period = cruxLookup.record?.collectionPeriod;
  const hasPeriod = period != null;
  const meta = {
    url: argumentList.url,
    formFactor: argumentList.formFactor,
    level,
    period: hasPeriod ? `${createDateStamp(period.firstDate)} → ${createDateStamp(period.lastDate)}` : null,
  };

  const isMachineReadable = argumentList.isMachineReadable;
  if (isMachineReadable) {
    const indentSpaceCount = 2;

    console.log(JSON.stringify({ ...meta, ...evaluated }, null, indentSpaceCount));
  } else {
    console.log(createReport(evaluated, meta));
  }

  const isEvaluationFailed = !evaluated.passed;
  if (isEvaluationFailed) process.exitCode = 1;
};

try {
  await runCruxCommand();
} catch (error) {
  const isErrorObject = error instanceof Error;
  console.error(isErrorObject ? error.message : String(error));
  const usageExitCode = 2;

  process.exit(usageExitCode);
}
