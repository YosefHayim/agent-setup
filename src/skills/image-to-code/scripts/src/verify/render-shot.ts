#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const firstArgumentIndex = 2;

const [inHtml, outPng, sizeArg, delayArg] = process.argv.slice(firstArgumentIndex);

const isHtmlOrPngMissing = !inHtml || !outPng;
if (isHtmlOrPngMissing) {
  console.error("usage: tsx src/verify/render-shot.ts <in.html> <out.png> [size] [delayMs]");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const defaultScreenshotSizePixels = 420;

const size = Number(sizeArg || defaultScreenshotSizePixels);
const delay = Number(delayArg || 0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.resolve(inHtml)).href, { waitUntil: "networkidle" });

const isDelayRequested = Boolean(delay);
if (isDelayRequested) await page.waitForTimeout(delay);

await page.screenshot({
  path: outPng,
  clip: { x: 0, y: 0, width: size, height: size },
  animations: isDelayRequested ? "allow" : "disabled",
});
await browser.close();
console.log(`wrote ${outPng} (${size}x${size})`);
