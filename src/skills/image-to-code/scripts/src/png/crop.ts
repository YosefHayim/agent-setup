#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";

const BYTES_PER_PIXEL = 4;

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const column = Number(readStringArgument(argumentList, "x"));
const y = Number(readStringArgument(argumentList, "y"));
const w = Number(readStringArgument(argumentList, "w"));
const h = Number(readStringArgument(argumentList, "h"));
const defaultScaleFactor = 3;

const s = Number(readStringArgument(argumentList, "scale") || defaultScaleFactor);
const out = readStringArgument(argumentList, "out");
const pngPath = readStringArgument(argumentList, "input") || "target.png";

const isCropArgumentMissing = !Number.isFinite(column) || !out;
if (isCropArgumentMissing) {
  console.error("usage: tsx src/png/crop.ts --x N --y N --w N --h N [--scale 3] --out out.png [--input target.png]");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const src = PNG.sync.read(fs.readFileSync(pngPath));
const outPng = new PNG({ width: w * s, height: h * s });
for (let oy = 0; oy < h * s; oy++) {
  for (let ox = 0; ox < w * s; ox++) {
    const sx = column + Math.floor(ox / s);
    const sy = y + Math.floor(oy / s);
    const si = (sy * src.width + sx) * BYTES_PER_PIXEL;
    const oi = (oy * outPng.width + ox) * BYTES_PER_PIXEL;
    outPng.data[oi] = src.data[si];
    outPng.data[oi + 1] = src.data[si + 1];
    const blueChannelOffset = 2;

    const blueByteOffsetInPixel = 2;

    outPng.data[oi + blueChannelOffset] = src.data[si + blueByteOffsetInPixel];
    const opaqueAlphaLevel = 255;

    const alphaChannelOffset = 3;

    outPng.data[oi + alphaChannelOffset] = opaqueAlphaLevel;
  }
}
fs.writeFileSync(out, PNG.sync.write(outPng));
console.log(`wrote ${out} (${w * s}x${h * s})`);
