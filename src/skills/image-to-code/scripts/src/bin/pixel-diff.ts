#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
/**
 * Render a build with Playwright, screenshot it, and pixel-diff against a target PNG.
 * Exit code: 0 if pass (ratio < max-ratio), 1 if fail, 2 on usage/IO error.
 */
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { argBool, argString, parseArgs } from "../lib/argv.js";
import type { DiffReport, HotspotCell } from "../lib/types.js";

function fail(message: string): never {
  console.error(`pixel-diff: ${message}`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const targetArg = argString(args, "target");
const inputArg = argString(args, "input");
if (!targetArg || !inputArg) {
  fail(
    "usage: tsx src/bin/pixel-diff.ts --target <design.png> --input <build.html|url> " +
      "[--out diff.png] [--threshold 0.1] [--max-ratio 0.001] [--width W] [--height H] [--no-freeze]",
  );
}

const targetPath = path.resolve(targetArg);
if (!fs.existsSync(targetPath)) fail(`target not found: ${targetPath}`);

const target = PNG.sync.read(fs.readFileSync(targetPath));
const width = args.width ? Number(args.width) : target.width;
const height = args.height ? Number(args.height) : target.height;
const colorThreshold = args.threshold ? Number(args.threshold) : 0.1;
const maxRatio = args["max-ratio"] ? Number(args["max-ratio"]) : 0.001;
const outPath = path.resolve(argString(args, "out") || "diff.png");
const freeze = !argBool(args, "no-freeze");

const url = /^(https?|file):\/\//.test(inputArg) ? inputArg : pathToFileURL(path.resolve(inputArg)).href;

let actual: PNG;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
  if (freeze) {
    await page.addStyleTag({
      content: "*,*::before,*::after{animation:none!important;transition:none!important;}",
    });
  }
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  actual = PNG.sync.read(shot);
} finally {
  await browser.close();
}

if (actual.width !== target.width || actual.height !== target.height) {
  fail(
    `screenshot ${actual.width}x${actual.height} != target ${target.width}x${target.height}; ` +
      `set --width/--height to the target's pixel size`,
  );
}

const diff = new PNG({ width, height });
const diffColor: [number, number, number] = [255, 0, 0];
const diffPixels = pixelmatch(target.data, actual.data, diff.data, width, height, {
  threshold: colorThreshold,
  includeAA: false,
  diffColor,
});
fs.writeFileSync(outPath, PNG.sync.write(diff));

const cols = 8;
const rows = Math.max(1, Math.min(16, Math.round((cols * height) / width)));
const cellW = width / cols;
const cellH = height / rows;
const cellCounts = new Array<number>(rows * cols).fill(0);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    const isDiff =
      diff.data[p] === diffColor[0] && diff.data[p + 1] === diffColor[1] && diff.data[p + 2] === diffColor[2];
    if (!isDiff) continue;
    const c = Math.min(cols - 1, Math.floor(x / cellW));
    const r = Math.min(rows - 1, Math.floor(y / cellH));
    cellCounts[r * cols + c]++;
  }
}
const hotspots: HotspotCell[] = cellCounts
  .map((count, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x0 = Math.round(c * cellW);
    const y0 = Math.round(r * cellH);
    const w = Math.round((c + 1) * cellW) - x0;
    const h = Math.round((r + 1) * cellH) - y0;
    return { count, pct: +((count / (w * h)) * 100).toFixed(2), bbox: { x: x0, y: y0, w, h } };
  })
  .filter((cell) => cell.count > 0)
  .sort((a, b) => b.count - a.count)
  .slice(0, 5);

const ratio = diffPixels / (width * height);
const report: DiffReport = {
  target: targetPath,
  input: url,
  dimensions: { width, height },
  diffPixels,
  ratio: +ratio.toFixed(5),
  ratioPct: +(ratio * 100).toFixed(3),
  maxRatio,
  pass: ratio < maxRatio,
  threshold: colorThreshold,
  diffImage: outPath,
  hotspots,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
