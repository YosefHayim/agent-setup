#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { parseArgumentList, readBooleanArgument, readStringArgument } from "#src/argv.js";
import type { DiffReport, HotspotCell } from "#src/types.js";

const PERCENT_SCALE = 100;

const fail: (message: string) => never = (message: string) => {
  console.error(`pixel-diff: ${message}`);
  const usageExitCode = 2;

  process.exit(usageExitCode);
};

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const targetPathArgument = readStringArgument(argumentList, "target");

const actualPathOrUrl = readStringArgument(argumentList, "input");

const isTargetOrActualMissing = !targetPathArgument || !actualPathOrUrl;
if (isTargetOrActualMissing) {
  fail(
    "usage: tsx src/bin/pixel-diff.ts --target <design.png> --input <build.html|url> " +
      "[--out diff.png] [--threshold 0.1] [--max-ratio 0.001] [--width W] [--height H] [--no-freeze]",
  );
}

const targetPath = path.resolve(targetPathArgument);

const isTargetFileMissing = !fs.existsSync(targetPath);
if (isTargetFileMissing) fail(`target not found: ${targetPath}`);

const target = PNG.sync.read(fs.readFileSync(targetPath));

const hasWidthOption = argumentList.width;
const width = hasWidthOption ? Number(argumentList.width) : target.width;

const hasHeightOption = argumentList.height;
const height = hasHeightOption ? Number(argumentList.height) : target.height;

const hasThresholdOption = argumentList.threshold;
const defaultColorThreshold = 0.1;

const colorThreshold = hasThresholdOption ? Number(argumentList.threshold) : defaultColorThreshold;

const hasMaxRatioOption = argumentList["max-ratio"];
const defaultMaxRatio = 0.001;

const maxRatio = hasMaxRatioOption ? Number(argumentList["max-ratio"]) : defaultMaxRatio;
const outPath = path.resolve(readStringArgument(argumentList, "out") || "diff.png");
const isFreezeRequested = !readBooleanArgument(argumentList, "no-freeze");

const isActualUrl = /^(https?|file):\/\//.test(actualPathOrUrl);
const url = isActualUrl ? actualPathOrUrl : pathToFileURL(path.resolve(actualPathOrUrl)).href;

let actual: PNG;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const hasFontsApi = document.fonts;
    if (hasFontsApi) await document.fonts.ready;
  });

  if (isFreezeRequested) {
    await page.addStyleTag({
      content: "*,*::before,*::after{animation:none!important;transition:none!important;}",
    });
  }

  const shot = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  actual = PNG.sync.read(shot);
} finally {
  await browser.close();
}

const isSizeDifferent = actual.width !== target.width || actual.height !== target.height;
if (isSizeDifferent) {
  fail(
    `screenshot ${actual.width}x${actual.height} != target ${target.width}x${target.height}; ` +
      `set --width/--height to the target's pixel size`,
  );
}

const diff = new PNG({ width, height });
const redDiffChannelLevel = 255;

const diffColor: [number, number, number] = [redDiffChannelLevel, 0, 0];
const diffPixels = pixelmatch(target.data, actual.data, diff.data, width, height, {
  threshold: colorThreshold,
  includeAA: false,
  diffColor,
});
fs.writeFileSync(outPath, PNG.sync.write(diff));

const columnCount = 8;
const maximumGridRows = 16;

const gridHeightCells = Math.max(1, Math.min(maximumGridRows, Math.round((columnCount * height) / width)));
const cellWidth = width / columnCount;
const cellHeight = height / gridHeightCells;
const cellCounts = new Array<number>(gridHeightCells * columnCount).fill(0);
for (let y = 0; y < height; y++) {
  for (let column = 0; column < width; column++) {
    const bytesPerPixel = 4;

    const pixelIndex = (y * width + column) * bytesPerPixel;

    const blueChannelOffset = 2;

    const isNotDiff =
      diff.data[pixelIndex] !== diffColor[0] ||
      diff.data[pixelIndex + 1] !== diffColor[1] ||
      diff.data[pixelIndex + blueChannelOffset] !== diffColor[2];
    if (isNotDiff) continue;

    const cellColumn = Math.min(columnCount - 1, Math.floor(column / cellWidth));
    const cellRow = Math.min(gridHeightCells - 1, Math.floor(y / cellHeight));
    cellCounts[cellRow * columnCount + cellColumn]++;
  }
}
const topDiffRegionCount = 5;

const hotspots: HotspotCell[] = cellCounts
  .map((count, index) => {
    const cellRow = Math.floor(index / columnCount);
    const cellColumn = index % columnCount;
    const cellLeft = Math.round(cellColumn * cellWidth);
    const cellTop = Math.round(cellRow * cellHeight);
    const cellPixelWidth = Math.round((cellColumn + 1) * cellWidth) - cellLeft;
    const cellPixelHeight = Math.round((cellRow + 1) * cellHeight) - cellTop;
    const pixelPercentDecimals = 2;

    return {
      count,
      pct: +((count / (cellPixelWidth * cellPixelHeight)) * PERCENT_SCALE).toFixed(pixelPercentDecimals),
      bbox: { x: cellLeft, y: cellTop, w: cellPixelWidth, h: cellPixelHeight },
    };
  })
  .filter((cell) => cell.count > 0)
  .sort((firstCell, secondCell) => secondCell.count - firstCell.count)
  .slice(0, topDiffRegionCount);

const ratio = diffPixels / (width * height);
const ratioPercentDecimals = 3;

const ratioDecimals = 5;

const report: DiffReport = {
  target: targetPath,
  input: url,
  dimensions: { width, height },
  diffPixels,
  ratio: +ratio.toFixed(ratioDecimals),
  ratioPct: +(ratio * PERCENT_SCALE).toFixed(ratioPercentDecimals),
  maxRatio,
  pass: ratio < maxRatio,
  threshold: colorThreshold,
  diffImage: outPath,
  hotspots,
};
const indentSpaceCount = 2;

console.log(JSON.stringify(report, null, indentSpaceCount));

const isReportPassing = report.pass;
process.exit(isReportPassing ? 0 : 1);
