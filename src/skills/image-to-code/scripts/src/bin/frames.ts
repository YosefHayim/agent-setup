#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
/**
 * Render an HTML at several animation timestamps into one horizontal contact sheet.
 * Usage: tsx src/bin/frames.ts <in.html> <out.png> <cell> <delayMs,delayMs,...>
 */
import { chromium } from "playwright";
import { PNG } from "pngjs";

const [inHtml, outPng, cellArg, delaysArg] = process.argv.slice(2);
if (!inHtml || !outPng) {
  console.error("usage: tsx src/bin/frames.ts <in.html> <out.png> [cell] [delayMs,delayMs,...]");
  process.exit(2);
}

const cell = Number(cellArg || 300);
const delays = (delaysArg || "0").split(",").map(Number);
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
sheet.data.fill(245);
shots.forEach((img, k) => {
  const ox = k * (cell + GAP);
  for (let y = 0; y < cell; y++)
    for (let x = 0; x < cell; x++) {
      const si = (y * cell + x) * 4;
      const di = (y * W + (x + ox)) * 4;
      sheet.data[di] = img.data[si];
      sheet.data[di + 1] = img.data[si + 1];
      sheet.data[di + 2] = img.data[si + 2];
      sheet.data[di + 3] = 255;
    }
});
fs.writeFileSync(outPng, PNG.sync.write(sheet));
console.log(`wrote ${outPng} (${delays.length} frames @ ${delays.join(",")}ms)`);
