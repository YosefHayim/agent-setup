#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const LIST_SEPARATOR = ",";

const BYTES_PER_PIXEL = 4;

const firstArgumentIndex = 2;

const [inHtml, outPng, cellArg, delaysArg] = process.argv.slice(firstArgumentIndex);

const isHtmlOrPngMissing = !inHtml || !outPng;
if (isHtmlOrPngMissing) {
  console.error("usage: tsx src/bin/frames.ts <in.html> <out.png> [cell] [delayMs,delayMs,...]");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const defaultCellSizePixels = 300;

const cell = Number(cellArg || defaultCellSizePixels);
const delays = (delaysArg || "0").split(LIST_SEPARATOR).map(Number);
const GAP = 12;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cell, height: cell }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.resolve(inHtml)).href, { waitUntil: "networkidle" });

const shots: PNG[] = [];
for (const d of delays) {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
  }, d);
  const buf = await page.screenshot({
    clip: { x: 0, y: 0, width: cell, height: cell },
    animations: "allow",
  });
  shots.push(PNG.sync.read(buf));
}
await browser.close();

const W = delays.length * cell + (delays.length - 1) * GAP;
const sheet = new PNG({ width: W, height: cell });
const sheetBackgroundGray = 245;

sheet.data.fill(sheetBackgroundGray);
shots.forEach((img, k) => {
  const ox = k * (cell + GAP);
  for (let y = 0; y < cell; y++)
    for (let column = 0; column < cell; column++) {
      const si = (y * cell + column) * BYTES_PER_PIXEL;
      const di = (y * W + (column + ox)) * BYTES_PER_PIXEL;
      sheet.data[di] = img.data[si];
      sheet.data[di + 1] = img.data[si + 1];
      const blueChannelOffset = 2;

      const blueByteOffsetInPixel = 2;

      sheet.data[di + blueChannelOffset] = img.data[si + blueByteOffsetInPixel];
      const opaqueAlphaLevel = 255;

      const alphaChannelOffset = 3;

      sheet.data[di + alphaChannelOffset] = opaqueAlphaLevel;
    }
});
fs.writeFileSync(outPng, PNG.sync.write(sheet));
console.log(`wrote ${outPng} (${delays.length} frames @ ${delays.join(LIST_SEPARATOR)}ms)`);
