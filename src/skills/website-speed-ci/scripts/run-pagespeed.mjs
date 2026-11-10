#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const NEWLINE_CHARACTER = "\n";

const MILLISECONDS_PER_SECOND = 1000;

const PASS_LABEL = "PASS";

const FAIL_LABEL = "FAIL";

const NOT_AVAILABLE_LABEL = "n/a";

const PERCENT_SCALE = 100;

const NUMBER_TYPE_NAME = "number";

const ORIGIN_READING_KIND = "origin";

const RATING_NEEDS_IMPROVEMENT = "needs-improvement";

const RATING_POOR = "poor";

const RATING_GOOD = "good";

const BUDGETS_FLAG_PREFIX = "--budgets=";

const KEY_FLAG_PREFIX = "--key=";

const STRATEGY_FLAG_PREFIX = "--strategy=";

const MOBILE_STRATEGY = "mobile";

const INP_METRIC_ID = "INP";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

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
  performanceScore: 0.9,
};

const METRICS = [
  {
    id: "LCP",
    field: "LARGEST_CONTENTFUL_PAINT_MS",
    audit: "largest-contentful-paint",
    budget: "lcpMs",
    good: LCP_GOOD_MILLISECONDS,
    poor: 4000,
    cls: false,
    core: true,
  },
  {
    id: INP_METRIC_ID,
    field: "INTERACTION_TO_NEXT_PAINT",
    audit: "total-blocking-time",
    budget: "inpMs",
    good: INP_GOOD_MILLISECONDS,
    poor: 500,
    cls: false,
    core: true,
  },
  {
    id: "CLS",
    field: "CUMULATIVE_LAYOUT_SHIFT_SCORE",
    audit: "cumulative-layout-shift",
    budget: "clsScore",
    good: CLS_GOOD_SCORE,
    poor: 0.25,
    cls: true,
    core: true,
  },
  {
    id: "FCP",
    field: "FIRST_CONTENTFUL_PAINT_MS",
    audit: "first-contentful-paint",
    budget: "fcpMs",
    good: ONE_POINT_EIGHT_SECONDS_MILLISECONDS,
    poor: 3000,
    cls: false,
    core: false,
  },
  {
    id: "TTFB",
    field: "EXPERIMENTAL_TIME_TO_FIRST_BYTE",
    audit: "server-response-time",
    budget: "ttfbMs",
    good: TTFB_GOOD_MILLISECONDS,
    poor: ONE_POINT_EIGHT_SECONDS_MILLISECONDS,
    cls: false,
    core: false,
  },
];

const createUsageMessage = () => {
  return [
    "PageSpeed Insights v5 field + lab checker.",
    "",
    "Usage:",
    "  node run-pagespeed.mjs <url> [--strategy=mobile|desktop] [--key=KEY]",
    "                              [--budgets=FILE] [--json] [--strict]",
    "",
    "The key may also come from the PSI_API_KEY environment variable.",
    "Exit 0 = within budget, 1 = budget breached, 2 = createUsageMessage/request error.",
  ].join(NEWLINE_CHARACTER);
};

const parseArgumentList = (argv) => {
  const argumentList = {
    strategy: MOBILE_STRATEGY,
    key: process.env.PSI_API_KEY,
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

    const isStrategyFlag = arg.startsWith(STRATEGY_FLAG_PREFIX);
    if (isStrategyFlag) {
      argumentList.strategy = arg.slice(STRATEGY_FLAG_PREFIX.length);
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

  const isStrategyInvalid = argumentList.strategy !== MOBILE_STRATEGY && argumentList.strategy !== "desktop";
  if (isStrategyInvalid) throw new Error("--strategy must be mobile or desktop");

  return argumentList;
};

const readRatingFromCategory = (category) => {
  const isCategoryFAST = category === "FAST";
  if (isCategoryFAST) return RATING_GOOD;

  const isCategoryAVERAGE = category === "AVERAGE";
  if (isCategoryAVERAGE) return RATING_NEEDS_IMPROVEMENT;

  const isCategorySLOW = category === "SLOW";
  if (isCategorySLOW) return RATING_POOR;

  return null;
};

const readRatingFromField = (field, good, poor) => {
  const isFieldGood = field <= good;
  if (isFieldGood) return RATING_GOOD;

  const isFieldPoor = field > poor;
  if (isFieldPoor) return RATING_POOR;

  return RATING_NEEDS_IMPROVEMENT;
};

const readFieldOrigin = (urlField, originField) => {
  const hasUrlField = Boolean(urlField);
  if (hasUrlField) return "this-url";

  const hasOriginField = Boolean(originField);
  if (hasOriginField) return ORIGIN_READING_KIND;

  return "lab-only";
};

const readMetric = (metric, measurements) => {
  const { urlField, originField, labAudits } = measurements;
  const isCumulativeLayoutShift = metric.cls === true;

  const readFieldReading = (experience, readingOrigin) => {
    const fieldMetric = experience?.metrics?.[metric.field];
    const isFieldMetricMissing = !fieldMetric || typeof fieldMetric.percentile !== NUMBER_TYPE_NAME;
    if (isFieldMetricMissing) return null;

    const fieldPercentile = isCumulativeLayoutShift ? fieldMetric.percentile / PERCENT_SCALE : fieldMetric.percentile;
    const rating =
      readRatingFromCategory(fieldMetric.category) || readRatingFromField(fieldPercentile, metric.good, metric.poor);
    return { value: fieldPercentile, rating, source: readingOrigin };
  };

  const fieldReading = readFieldReading(urlField, "field") || readFieldReading(originField, ORIGIN_READING_KIND);
  const isFieldReadingFound = fieldReading != null;
  if (isFieldReadingFound) return fieldReading;

  const audit = labAudits?.[metric.audit];
  const isAuditNumeric = audit != null && typeof audit.numericValue === NUMBER_TYPE_NAME;

  if (isAuditNumeric) {
    const labReading = isCumulativeLayoutShift ? audit.numericValue : Math.round(audit.numericValue);
    // INP has no lab equivalent — total-blocking-time is only a proxy, so we
    // report it but never hard-fail on it.
    return {
      value: labReading,
      rating: readRatingFromField(labReading, metric.good, metric.poor),
      source: "lab",
      proxy: metric.id === INP_METRIC_ID,
    };
  }

  return { value: null, rating: NOT_AVAILABLE_LABEL, source: "none" };
};

const createMetricLabel = (metric, metricNumber) => {
  const isReadingMissing = metricNumber === null;
  if (isReadingMissing) return "—";

  const isCumulativeLayoutShift = metric.cls === true;
  const clsDecimals = 2;

  if (isCumulativeLayoutShift) return metricNumber.toFixed(clsDecimals);

  const isOverOneSecond = metricNumber >= MILLISECONDS_PER_SECOND;
  return isOverOneSecond
    ? `${(metricNumber / MILLISECONDS_PER_SECOND).toFixed(1)} s`
    : `${Math.round(metricNumber)} ms`;
};

const evaluate = (psiDocument, budgets, strict) => {
  const labScore = psiDocument?.lighthouseResult?.categories?.performance?.score ?? null;
  const labAudits = psiDocument?.lighthouseResult?.audits;
  const urlField = psiDocument?.loadingExperience;
  const originField = psiDocument?.originLoadingExperience;

  const metricChecks = METRICS.map((metric) => {
    const metricReading = readMetric(metric, { urlField, originField, labAudits });
    const budget = budgets[metric.budget];
    const overBudget = metricReading.value !== null && metricReading.value > budget;
    const coreFail = metric.core && metricReading.rating === RATING_POOR && !metricReading.proxy;
    const strictFail =
      strict && metric.core && (metricReading.rating !== RATING_GOOD || overBudget) && !metricReading.proxy;
    return { ...metric, ...metricReading, budget, overBudget, failed: coreFail || strictFail };
  });

  const scoreFailed = labScore !== null && labScore < budgets.performanceScore;
  const passed = !scoreFailed && !metricChecks.some((metricCheck) => metricCheck.failed);
  const fieldOrigin = readFieldOrigin(urlField, originField);

  return { labScore, rows: metricChecks, scoreFailed, passed, fieldOrigin };
};

const readMetricFlag = (metricCheck) => {
  const isMetricFailed = metricCheck.failed;
  if (isMetricFailed) return "  ✗ FAIL";

  const isMetricNeedingImprovement = metricCheck.rating === RATING_NEEDS_IMPROVEMENT;
  if (isMetricNeedingImprovement) return "  ! warn";

  return "";
};

const createReport = (assessment, meta) => {
  const lines = [`PageSpeed Insights — ${meta.url} (${meta.strategy})`, ""];
  const hasLabScore = assessment.labScore !== null;
  const score = hasLabScore ? Math.round(assessment.labScore * PERCENT_SCALE) : NOT_AVAILABLE_LABEL;
  const isScoreFailed = assessment.scoreFailed;
  const scoreMark = isScoreFailed ? FAIL_LABEL : PASS_LABEL;
  lines.push(
    `Lab performance score: ${score}  (budget ≥ ${Math.round(meta.budgets.performanceScore * PERCENT_SCALE)})  ${scoreMark}`,
    "",
  );
  lines.push(`Real-user Core Web Vitals (source: ${assessment.fieldOrigin}):`);

  for (const metricCheck of assessment.rows) {
    const flag = readMetricFlag(metricCheck);
    const isProxyMetric = Boolean(metricCheck.proxy);
    const proxy = isProxyMetric ? " [lab TBT proxy]" : "";
    const budget = `budget ≤ ${createMetricLabel(metricCheck, metricCheck.budget)}`;
    const metricRatingColumnWidth = 18;

    const metricLabelColumnWidth = 9;

    const metricIdColumnWidth = 5;

    lines.push(
      `  ${metricCheck.id.padEnd(metricIdColumnWidth)} ${createMetricLabel(metricCheck, metricCheck.value).padEnd(metricLabelColumnWidth)} ${metricCheck.rating.padEnd(metricRatingColumnWidth)} (${budget})${proxy}${flag}`,
    );
  }

  const isPassed = assessment.passed;
  lines.push("", `Verdict: ${isPassed ? PASS_LABEL : FAIL_LABEL}`);
  return lines.join(NEWLINE_CHARACTER);
};

const loadBudgets = async (budgetsFile) => {
  const isBudgetsFileMissing = !budgetsFile;
  if (isBudgetsFileMissing) return DEFAULT_BUDGETS;

  const budgetsDocument = await readFile(budgetsFile, "utf8");
  return { ...DEFAULT_BUDGETS, ...JSON.parse(budgetsDocument) };
};

const readPsiErrorMessage = async (httpReply) => {
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

const fetchPsi = async (url, strategy, key) => {
  const parameters = new URLSearchParams({ url, strategy, category: "performance" });
  const isKeyGiven = Boolean(key);
  if (isKeyGiven) parameters.set("key", key);

  const httpReply = await fetch(`${PSI_ENDPOINT}?${parameters.toString()}`);
  const isReplyOk = httpReply.ok;
  if (isReplyOk) return httpReply.json();

  const errorMessage = await readPsiErrorMessage(httpReply);
  throw new Error(`PageSpeed request failed: ${errorMessage}`);
};

const runPagespeedCommand = async () => {
  const firstArgumentIndex = 2;

  const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
  const isHelpRequested = Boolean(argumentList.help);
  if (isHelpRequested) {
    console.log(createUsageMessage());
    return;
  }

  const budgets = await loadBudgets(argumentList.budgets);
  const psiDocument = await fetchPsi(argumentList.url, argumentList.strategy, argumentList.key);
  const assessment = evaluate(psiDocument, budgets, argumentList.strict);

  const isMachineReadable = argumentList.isMachineReadable;
  if (isMachineReadable) {
    const indentSpaceCount = 2;

    console.log(
      JSON.stringify({ url: argumentList.url, strategy: argumentList.strategy, ...assessment }, null, indentSpaceCount),
    );
  } else {
    console.log(createReport(assessment, { url: argumentList.url, strategy: argumentList.strategy, budgets }));
  }

  const isAssessmentFailed = !assessment.passed;
  if (isAssessmentFailed) process.exitCode = 1;
};

try {
  await runPagespeedCommand();
} catch (error) {
  const isErrorObject = error instanceof Error;
  console.error(isErrorObject ? error.message : String(error));
  const usageExitCode = 2;

  process.exit(usageExitCode);
}
