#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
/** Screenshot an HTML file to PNG at a given square size. */
import { chromium } from "playwright";

const [inHtml, outPng, sizeArg, delayArg] = process.argv.slice(2);
if (!inHtml || !outPng) {
  console.error("usage: tsx src/verify/render-shot.ts <in.html> <out.png> [size] [delayMs]");
  process.exit(2);
}

const size = Number(sizeArg || 420);
const delay = Number(delayArg || 0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.resolve(inHtml)).href, { waitUntil: "networkidle" });
if (delay) await page.waitForTimeout(delay);
await page.screenshot({
  path: outPng,
  clip: { x: 0, y: 0, width: size, height: size },
  animations: delay ? "allow" : "disabled",
});
await browser.close();
console.log(`wrote ${outPng} (${size}x${size})`);
