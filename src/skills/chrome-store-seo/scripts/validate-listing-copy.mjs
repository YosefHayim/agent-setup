#!/usr/bin/env node

import { readFileSync } from "node:fs";

const MAX_LINE_LENGTH = 80;

const UTF8_ENCODING = "utf8";

const LIMITS = {
  name: 75,
  summary: 132,
  description: 16_000,
};

const SUMMARY_SUPERLATIVES = /\b(best|greatest|fastest|number\s*one|#1|top-rated|world.?class)\b/i;

const isKeywordDump = (line) => {
  const trimmed = line.trim().replace(/^[—\-*•]\s*/, "");
  const minimumDescriptionLength = 24;

  const isTooShort = trimmed.length < minimumDescriptionLength;
  if (isTooShort) return false;

  const separators = (trimmed.match(/[,|]/g) || []).length;
  const minimumSeparatorCount = 5;

  const hasFewSeparators = separators < minimumSeparatorCount;
  if (hasFewSeparators) return false;

  const words = trimmed.split(/[\s,|•·/;]+/).filter(Boolean);
  const minimumWordCount = 6;

  const hasFewWords = words.length < minimumWordCount;
  if (hasFewWords) return false;

  const averageWordLength = words.reduce((total, word) => total + word.length, 0) / words.length;
  const density = separators / words.length;
  const maximumAverageWordLength = 14;

  const keywordDumpDensity = 0.45;

  return density >= keywordDumpDensity && averageWordLength <= maximumAverageWordLength && !/[.?!]/.test(trimmed);
};

const STOPWORDS = new Set(
  `with from that this than then they them their into onto over under about after before while where which when what your yours have been were will just only also more most other such into across using used use each many both some any all and for the are was not but can may does did`.split(
    /\s+/,
  ),
);

const minimumTokenLength = 4;

const tokenize = (copy) =>
  copy
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= minimumTokenLength && !STOPWORDS.has(token));

const countTokens = (copy) => {
  const counts = new Map();
  for (const token of tokenize(copy)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
};

const createUsageMessage = () =>
  [
    "Chrome Web Store listing copy validator (limits + Keyword Spam heuristics).",
    "",
    "Usage:",
    '  node validate-listing-copy.mjs --name "…" --summary "…" --description "…"',
    "  node validate-listing-copy.mjs --json-file ./listing-copy.json [--strict] [--json]",
    "",
    "Exit 0 = pass, 1 = errors, 2 = createUsageMessage/IO failure.",
  ].join("\n");

const describeError = (error) => {
  const isErrorObject = error instanceof Error;
  return isErrorObject ? error.message : String(error);
};

const parseArgumentList = (argv) => {
  const argumentList = {
    name: "",
    summary: "",
    description: "",
    listingFile: null,
    descriptionFile: null,
    strict: false,
    isMachineReadable: false,
    help: false,
  };
  for (let argumentIndex = 0; argumentIndex < argv.length; argumentIndex++) {
    const arg = argv[argumentIndex];
    switch (arg) {
      case "--help":
      case "-h":
        argumentList.help = true;
        break;
      case "--strict":
        argumentList.strict = true;
        break;
      case "--json":
        argumentList.isMachineReadable = true;
        break;
      case "--name":
        argumentList.name = argv[++argumentIndex] || "";
        break;
      case "--summary":
        argumentList.summary = argv[++argumentIndex] || "";
        break;
      case "--description":
        argumentList.description = argv[++argumentIndex] || "";
        break;
      case "--description-file":
        argumentList.descriptionFile = argv[++argumentIndex] || null;
        break;
      case "--json-file":
        argumentList.listingFile = argv[++argumentIndex] || null;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return argumentList;
};

const readListingDocument = (listingFile) => {
  const isListingFileGiven = Boolean(listingFile);
  if (!isListingFileGiven) return {};

  return JSON.parse(readFileSync(listingFile, UTF8_ENCODING));
};

const readListingFields = (argumentList) => {
  const listingDocument = readListingDocument(argumentList.listingFile);
  const name = String(listingDocument.name || argumentList.name || "");
  const summary = String(listingDocument.summary || argumentList.summary || "");
  const descriptionFromListing = String(listingDocument.description || argumentList.description || "");

  const isDescriptionFileGiven = Boolean(argumentList.descriptionFile);
  const description = isDescriptionFileGiven
    ? readFileSync(argumentList.descriptionFile, UTF8_ENCODING)
    : descriptionFromListing;

  return { name, summary, description };
};

const readListingFieldsOrNull = (argumentList) => {
  try {
    return readListingFields(argumentList);
  } catch (error) {
    console.error(describeError(error));
    return null;
  }
};

const readArgumentListOrNull = (argv) => {
  try {
    return parseArgumentList(argv);
  } catch (error) {
    console.error(describeError(error));
    console.error(createUsageMessage());
    return null;
  }
};

const validate = ({ name, summary, description }, { strict }) => {
  const errors = [];
  const warnings = [];
  const isStrictRun = Boolean(strict);

  const isNameEmpty = !name.trim();
  if (isNameEmpty) errors.push("name is empty");

  const isSummaryEmpty = !summary.trim();
  if (isSummaryEmpty) errors.push("summary is empty");

  const isDescriptionEmpty = !description.trim();
  if (isDescriptionEmpty) errors.push("description is empty");

  const isNameTooLong = name.length > LIMITS.name;
  if (isNameTooLong) errors.push(`name is ${name.length} chars (limit ${LIMITS.name})`);

  const isSummaryTooLong = summary.length > LIMITS.summary;
  if (isSummaryTooLong) errors.push(`summary is ${summary.length} chars (limit ${LIMITS.summary})`);

  const isDescriptionTooLong = description.length > LIMITS.description;
  if (isDescriptionTooLong) errors.push(`description is ${description.length} chars (limit ${LIMITS.description})`);

  const hasSuperlative = SUMMARY_SUPERLATIVES.test(summary);
  if (hasSuperlative)
    errors.push('summary contains a superlative (avoid "best", "greatest", "fastest", "#1" per CWS listing guide)');

  for (const line of description.split(/\r?\n/)) {
    const isKeywordDumpLine = isKeywordDump(line);
    if (isKeywordDumpLine) {
      const isLineTruncated = line.length > MAX_LINE_LENGTH;
      errors.push(
        `description line looks like a keyword/brand dump: "${line.slice(0, MAX_LINE_LENGTH)}${isLineTruncated ? "…" : ""}"`,
      );
    }
  }

  const counts = countTokens(description);
  const maximumRepeatsPerToken = 5;

  const overusedTokens = [...counts.entries()]
    .filter(([, repeatCount]) => repeatCount > maximumRepeatsPerToken)
    .sort((a, b) => b[1] - a[1]);

  for (const [token, repeatCount] of overusedTokens) {
    const repeatMessage = `token "${token}" appears ${repeatCount} times in description (CWS flags unnatural repeats >5 — review context)`;
    if (isStrictRun) errors.push(repeatMessage);
    else warnings.push(repeatMessage);
  }

  const nameWords = tokenize(name);
  const maximumNameWordCount = 10;

  const isNameTooManyTokens = nameWords.length >= maximumNameWordCount;
  if (isNameTooManyTokens) warnings.push("name has many tokens — prefer brief brand + one job phrase");

  const topTokenCount = 12;

  return {
    limits: LIMITS,
    lengths: {
      name: name.length,
      summary: summary.length,
      description: description.length,
    },
    tokenTop: overusedTokens.slice(0, topTokenCount).map(([token, count]) => ({ token, count })),
    errors,
    warnings,
    ok: errors.length === 0,
  };
};

const runValidationCommand = () => {
  const firstArgumentIndex = 2;

  const argumentList = readArgumentListOrNull(process.argv.slice(firstArgumentIndex));
  const isArgumentListMissing = argumentList == null;
  const missingArgumentListExitCode = 2;

  if (isArgumentListMissing) process.exit(missingArgumentListExitCode);

  const isHelpRequested = argumentList.help;
  if (isHelpRequested) {
    console.log(createUsageMessage());
    process.exit(0);
  }

  const fields = readListingFieldsOrNull(argumentList);
  const isFieldsMissing = fields == null;
  const missingFieldsExitCode = 2;

  if (isFieldsMissing) process.exit(missingFieldsExitCode);

  const isNothingGiven = !fields.name && !fields.summary && !fields.description && !argumentList.listingFile;
  if (isNothingGiven) {
    console.error(createUsageMessage());
    const usageExitCode = 2;

    process.exit(usageExitCode);
  }

  const report = validate(fields, { strict: argumentList.strict });

  const isMachineReadable = argumentList.isMachineReadable;
  if (isMachineReadable) {
    const indentSpaceCount = 2;

    console.log(JSON.stringify(report, null, indentSpaceCount));
  } else {
    console.log("CWS listing copy validation");
    console.log(`  name:        ${report.lengths.name}/${LIMITS.name}`);
    console.log(`  summary:     ${report.lengths.summary}/${LIMITS.summary}`);
    console.log(`  description: ${report.lengths.description}/${LIMITS.description}`);

    const hasTokenTop = report.tokenTop.length > 0;
    if (hasTokenTop) {
      console.log("  high-frequency tokens:");
      for (const { token, count } of report.tokenTop) {
        console.log(`    ${token}: ${count}`);
      }
    }

    for (const warning of report.warnings) console.log(`  WARN  ${warning}`);
    for (const errorLine of report.errors) console.log(`  ERROR ${errorLine}`);
    const isReportPassing = report.ok;
    console.log(isReportPassing ? "PASS" : "FAIL");
  }

  const isReportPassing = report.ok;
  process.exit(isReportPassing ? 0 : 1);
};

runValidationCommand();
