#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const BYTES_PER_KIBIBYTE = 1024;

const FLAG_PREFIX = "--";

const ASTRO_FILE_EXTENSION = ".astro";

const AGENT_READABILITY_LABEL = "Machine-readability (agents)";

const SEO_DIMENSION_LABEL = "SEO metadata";

const SEO_DIMENSION_ID = "seo";

const OK = "ok";
const PARTIAL = "partial";
const MISSING = "missing";
const NOT_APPLICABLE = "na";
const SECURITY_DIMENSION_ID = "security";
const AGENTS_DIMENSION_ID = "agents";
const INTERNAL_TOOL_EVIDENCE = "internal tool — not a public web surface";

const createDimension = ({ id, label, score, evidence, warn }) => {
  return { id, label, score, evidence, warn: warn ?? null };
};

const createYesNoLabel = (isPresent) => {
  return isPresent ? "yes" : "no";
};

const readScore = (isComplete, isPartial) => {
  if (isComplete) return OK;

  if (isPartial) return PARTIAL;

  return MISSING;
};

const createSecurityEvidence = (codeMarkers, fileMarkers) => {
  const isHeadersFilePresent = Boolean(fileMarkers.headers);
  if (isHeadersFilePresent) return "public/_headers present";

  const isCspSetInHeaders = codeMarkers.hasHeadersFunction && codeMarkers.csp;
  if (isCspSetInHeaders) return "next.config headers() + CSP";

  const isManifestCspFound = codeMarkers.manifestCsp;
  if (isManifestCspFound) return "MV3 manifest CSP";

  const isCspStringFound = codeMarkers.csp;
  if (isCspStringFound) return "CSP string found but wiring unclear";

  return "no CSP/HSTS found";
};

const scoreDimensions = (collectedSignals, settings = {}) => {
  const isInternal = Boolean(settings.internal);
  const codeMarkers = collectedSignals.codeMarkers;
  const fileMarkers = collectedSignals.fileMarkers;
  const dimensions = [];

  const hasMainTag = codeMarkers.mainTag > 0;
  dimensions.push(
    createDimension({
      id: "semantic",
      label: "Semantic HTML & landmarks",
      score: readScore(hasMainTag && codeMarkers.landmarks && codeMarkers.clickableDiv === 0, hasMainTag),
      evidence: `${codeMarkers.mainTag} <runAuditCommand>, landmarks ${createYesNoLabel(codeMarkers.landmarks)}, ${codeMarkers.clickableDiv} clickable <div>`,
      warn: "verify exactly one <runAuditCommand> per rendered page (nested <runAuditCommand> is the common bug)",
    }),
  );

  const isImageAltMissing = codeMarkers.imgTag > 0 && codeMarkers.altAttr === 0;
  const isLabelMissing = !codeMarkers.labelAssoc;
  const isA11yPartial = isImageAltMissing || isLabelMissing;
  dimensions.push(
    createDimension({
      id: "a11y",
      label: "Accessibility",
      score: isA11yPartial ? PARTIAL : OK,
      evidence: `${codeMarkers.imgTag} raw <img>, ${codeMarkers.altAttr} alt=, label assoc ${createYesNoLabel(codeMarkers.labelAssoc)}`,
      warn: "confirm alt text is meaningful (not filler) and every input has a linked <label>",
    }),
  );

  const imgOk = codeMarkers.nextImage || codeMarkers.modernAsset;
  const fontOk = codeMarkers.nextFont || codeMarkers.fontDisplay;
  dimensions.push(
    createDimension({
      id: "media",
      label: "Images & fonts",
      score: readScore(imgOk && fontOk, imgOk || fontOk),
      evidence: `next/image ${createYesNoLabel(codeMarkers.nextImage)}, webp/avif ${createYesNoLabel(codeMarkers.modernAsset)}, font-display ${createYesNoLabel(fontOk)}`,
      warn: 'check explicit width/height on images (CLS) and loading="lazy" below the fold',
    }),
  );

  const isCodeSplit = codeMarkers.dynamicImport;
  dimensions.push(
    createDimension({
      id: "perf",
      label: "Performance/CWV",
      score: isCodeSplit ? OK : PARTIAL,
      evidence: `code-splitting ${isCodeSplit ? "present" : "not detected"}`,
      warn: "measured LCP/INP/CLS live in the website-speed-ci skill — this is a static hint only",
    }),
  );

  const secOk =
    (fileMarkers.headers && (codeMarkers.csp || codeMarkers.hsts)) ||
    (codeMarkers.hasHeadersFunction && codeMarkers.csp) ||
    codeMarkers.manifestCsp;
  const secPartial = fileMarkers.headers || codeMarkers.csp || codeMarkers.hasHeadersFunction;
  dimensions.push(
    createDimension({
      id: SECURITY_DIMENSION_ID,
      label: "Security headers",
      score: readScore(secOk, secPartial),
      evidence: createSecurityEvidence(codeMarkers, fileMarkers),
      warn: "confirm the CSP is real (not unsafe-inline everywhere) and HSTS + X-Content-Type-Options are set",
    }),
  );

  if (isInternal) {
    dimensions.push(
      createDimension({
        id: SEO_DIMENSION_ID,
        label: SEO_DIMENSION_LABEL,
        score: NOT_APPLICABLE,
        evidence: INTERNAL_TOOL_EVIDENCE,
        warn: null,
      }),
    );
    dimensions.push(
      createDimension({
        id: AGENTS_DIMENSION_ID,
        label: AGENT_READABILITY_LABEL,
        score: NOT_APPLICABLE,
        evidence: INTERNAL_TOOL_EVIDENCE,
        warn: null,
      }),
    );
    return dimensions;
  }

  const seoHits = [
    codeMarkers.htmlLang,
    codeMarkers.titleMeta,
    codeMarkers.descMeta,
    codeMarkers.og,
    fileMarkers.robots || fileMarkers.sitemap,
  ].filter(Boolean).length;
  const partialScoreHitCount = 2;

  const fullScoreHitCount = 4;

  dimensions.push(
    createDimension({
      id: SEO_DIMENSION_ID,
      label: SEO_DIMENSION_LABEL,
      score: readScore(seoHits >= fullScoreHitCount, seoHits >= partialScoreHitCount),
      evidence: `lang ${createYesNoLabel(codeMarkers.htmlLang)}, title ${createYesNoLabel(codeMarkers.titleMeta)}, desc ${createYesNoLabel(codeMarkers.descMeta)}, OG ${createYesNoLabel(codeMarkers.og)}, robots/sitemap ${createYesNoLabel(fileMarkers.robots || fileMarkers.sitemap)}`,
      warn: null,
    }),
  );

  dimensions.push(
    createDimension({
      id: AGENTS_DIMENSION_ID,
      label: AGENT_READABILITY_LABEL,
      score: readScore(fileMarkers.llmsTxt && codeMarkers.jsonLd, fileMarkers.llmsTxt || codeMarkers.jsonLd),
      evidence: `llms.txt ${createYesNoLabel(fileMarkers.llmsTxt)}, JSON-LD ${createYesNoLabel(codeMarkers.jsonLd)}, robots ${createYesNoLabel(fileMarkers.robots)}`,
      warn: "ensure JSON-LD is server-rendered and content is in the initial HTML (not JS-only)",
    }),
  );

  return dimensions;
};

const listCriticalFailures = (dimensionScores, settings = {}) => {
  const isStrict = Boolean(settings.strict);
  const criticalDimensionIds = new Set(
    isStrict ? [SECURITY_DIMENSION_ID, AGENTS_DIMENSION_ID] : [SECURITY_DIMENSION_ID],
  );
  return dimensionScores
    .filter((dimension) => criticalDimensionIds.has(dimension.id) && dimension.score === MISSING)
    .map((dimension) => dimension.id);
};

const ignoredFolderNames = new Set([
  "node_modules",
  "dist",
  "out",
  "build",
  "coverage",
  ".next",
  ASTRO_FILE_EXTENSION,
  ".turbo",
  ".open-next",
  ".vercel",
  ".wrangler",
  ".git",
]);
const codeFileExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ASTRO_FILE_EXTENSION,
  ".html",
  ".css",
  ".mdx",
  ".json",
]);
const statusMarks = { ok: "✓", partial: "◐", missing: "✗", na: "–" };

const readDirectoryEntriesOrEmpty = (directory) => {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    // An unreadable folder is skipped.
    return [];
  }
};

const listFilesUnder = (directory) => {
  const directoryEntries = readDirectoryEntriesOrEmpty(directory);
  return directoryEntries.flatMap((folderChild) => {
    const fullPath = path.join(directory, folderChild.name);
    const isDirectory = folderChild.isDirectory();
    const isHiddenFolder = folderChild.name.startsWith(".") && folderChild.name.length > 1;
    const isSkippedFolder = isDirectory && (ignoredFolderNames.has(folderChild.name) || isHiddenFolder);
    if (isSkippedFolder) return [];

    if (isDirectory) return listFilesUnder(fullPath);

    return [fullPath];
  });
};

const countMatches = (pattern, code) => {
  const matches = code.match(pattern);
  const hasMatches = matches !== null;
  return hasMatches ? matches.length : 0;
};

const readCodeMarkers = (scannedCode, modernAsset) => {
  return {
    mainTag: countMatches(/<runAuditCommand[\s/>]/g, scannedCode),
    landmarks:
      /<(header|nav|footer|section|aside|search)[\s/>]/i.test(scannedCode) ||
      /role=["'](banner|navigation|runAuditCommand|contentinfo|complementary|search)["']/i.test(scannedCode),
    clickableDiv: countMatches(/<div[^>]*\son(?:Click|MouseDown)=/gi, scannedCode),
    imgTag: countMatches(/<img[\s/>]/gi, scannedCode),
    altAttr: countMatches(/\balt=/g, scannedCode),
    labelAssoc: /htmlFor=|aria-label(?:ledby)?=|<label[\s>]/i.test(scannedCode),
    nextImage: /from\s+["']next\/image["']/.test(scannedCode),
    modernAsset: modernAsset || /\.(?:webp|avif)\b/i.test(scannedCode),
    nextFont: /next\/font/.test(scannedCode),
    fontDisplay: /font-display\s*:/i.test(scannedCode) || /display:\s*["']swap["']/.test(scannedCode),
    dynamicImport: /next\/dynamic|React\.lazy|\blazy\(|\bimport\(/.test(scannedCode),
    csp: /Content-Security-Policy/i.test(scannedCode),
    hsts: /Strict-Transport-Security/i.test(scannedCode),
    hasHeadersFunction: /async\s+headers\s*\(|\bheaders\s*\(\s*\)\s*\{/.test(scannedCode),
    manifestCsp: /content_security_policy/i.test(scannedCode),
    htmlLang: /<html[^>]*\slang=|\blang:\s*["']/.test(scannedCode),
    titleMeta: /<title[\s>]|title:\s*["'`]|export\s+const\s+metadata|generateMetadata/.test(scannedCode),
    descMeta: /description:\s*["'`]|name=["']description["']/.test(scannedCode),
    og: /openGraph|property=["']og:|og:title/.test(scannedCode),
    jsonLd: /application\/ld\+json/.test(scannedCode),
  };
};

const readFileOrEmpty = (filePath) => {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    // An unreadable file still counts as present; it just adds no markers.
    return "";
  }
};

const collectSignals = (root) => {
  const maxScannedFiles = 4000;
  const maxScannedMebibytes = 8;

  const maxScannedBytes = maxScannedMebibytes * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
  const fileMarkers = { headers: false, llmsTxt: false, robots: false, sitemap: false, nextConfig: false };
  let scannedCode = "";
  let totalBytes = 0;
  let scannedCount = 0;
  let modernAsset = false;

  for (const fullPath of listFilesUnder(root)) {
    const baseName = path.basename(fullPath).toLowerCase();
    const extension = path.extname(fullPath).toLowerCase();
    const relativePath = path.relative(root, fullPath).split(path.sep).join("/").toLowerCase();

    const isHeadersFile = baseName === "_headers";
    if (isHeadersFile) {
      fileMarkers.headers = true;
      // no extension, so it is not in codeFileExtensions; read it so CSP/HSTS detection can see the directives
      scannedCode += `\n${readFileOrEmpty(fullPath)}`;
    }

    const isLlmsTxt = relativePath.includes("llms.txt") || baseName === "llms-full.txt";
    if (isLlmsTxt) fileMarkers.llmsTxt = true;

    // `.txt.ts` / `.xml.ts` catch Astro/Next endpoint files (e.g. `sitemap.xml.ts` becomes route `/sitemap.xml`).
    const isRobotsFile =
      baseName === "robots.txt" ||
      baseName.startsWith("robots.txt.") ||
      baseName === "robots.ts" ||
      baseName === "robots.js";
    if (isRobotsFile) fileMarkers.robots = true;

    const isSitemapFile =
      baseName === "sitemap.xml" ||
      baseName.startsWith("sitemap.xml.") ||
      baseName === "sitemap.ts" ||
      baseName === "sitemap.js";
    if (isSitemapFile) fileMarkers.sitemap = true;

    const isNextSettingsFile = /^next\.config\.(?:js|mjs|ts|cjs)$/.test(baseName);
    if (isNextSettingsFile) fileMarkers.nextConfig = true;

    const isModernImage = extension === ".webp" || extension === ".avif";
    if (isModernImage) modernAsset = true;

    const isScannedCodeFile =
      codeFileExtensions.has(extension) && scannedCount < maxScannedFiles && totalBytes < maxScannedBytes;
    if (isScannedCodeFile) {
      const scannedFileCode = readFileOrEmpty(fullPath);
      scannedCode += `\n${scannedFileCode}`;
      totalBytes += Buffer.byteLength(scannedFileCode);
      scannedCount += 1;
    }
  }

  return { fileMarkers, codeMarkers: readCodeMarkers(scannedCode, modernAsset), filesScanned: scannedCount };
};

const runAuditCommand = (processArgv) => {
  const firstArgumentIndex = 2;

  const argumentList = processArgv.slice(firstArgumentIndex);
  const flags = new Set(argumentList.filter((argument) => argument.startsWith(FLAG_PREFIX)));

  const directoryArgument = argumentList.find((argument) => !argument.startsWith(FLAG_PREFIX));
  const isDirectoryArgumentMissing = !directoryArgument;
  if (isDirectoryArgumentMissing) {
    console.error("usage: node audit-site.mjs <project-dir> [--internal] [--strict] [--json]");
    const missingDirectoryExitCode = 2;

    return missingDirectoryExitCode;
  }

  const root = path.resolve(directoryArgument);
  const isNotDirectory = !existsSync(root) || !statSync(root).isDirectory();
  if (isNotDirectory) {
    console.error(`not a directory: ${root}`);
    const unreadableDirectoryExitCode = 2;

    return unreadableDirectoryExitCode;
  }

  const isInternal = flags.has("--internal");
  const isStrict = flags.has("--strict");
  const collectedSignals = collectSignals(root);
  const dimensionScores = scoreDimensions(collectedSignals, { internal: isInternal });
  const failures = listCriticalFailures(dimensionScores, { strict: isStrict });
  const hasFailures = failures.length > 0;

  const isMachineReadable = flags.has("--json");
  if (isMachineReadable) {
    const report = { root, internal: isInternal, strict: isStrict, scores: dimensionScores, failures };
    const indentSpaceCount = 2;

    console.log(JSON.stringify(report, null, indentSpaceCount));
    return hasFailures ? 1 : 0;
  }

  console.log(`\ncheck-website-quality — ${path.basename(root)}${isInternal ? " (internal)" : ""}`);
  console.log(`scanned ${collectedSignals.filesScanned} source files\n`);
  for (const dimension of dimensionScores) {
    const labelColumnWidth = 30;

    console.log(`${statusMarks[dimension.score]} ${dimension.label.padEnd(labelColumnWidth)} ${dimension.evidence}`);

    const isWarningShown = Boolean(dimension.warn) && dimension.score !== NOT_APPLICABLE;
    if (isWarningShown) console.log(`   ⚠ ${dimension.warn}`);
  }
  console.log("");

  if (hasFailures) {
    console.log(`FAIL — critical gap: ${failures.join(", ")}. See SKILL.md → Fix (reuse before create).`);
  } else {
    console.log("PASS — no critical gaps. Do the agent semantic pass on any ◐ before claiming compliance.");
  }

  return hasFailures ? 1 : 0;
};

process.exit(runAuditCommand(process.argv));
