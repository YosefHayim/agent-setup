#!/usr/bin/env node
import fs from "node:fs";
/** Crop a bbox from a PNG and nearest-neighbor upscale. */
import { PNG } from "pngjs";
import { argString, parseArgs } from "../lib/argv.js";

const args = parseArgs(process.argv.slice(2));
const x = Number(argString(args, "x"));
const y = Number(argString(args, "y"));
const w = Number(argString(args, "w"));
const h = Number(argString(args, "h"));
const s = Number(argString(args, "scale") || 3);
const out = argString(args, "out");
const input = argString(args, "input") || "target.png";

if (!Number.isFinite(x) || !out) {
  console.error("usage: tsx src/png/crop.ts --x N --y N --w N --h N [--scale 3] --out out.png [--input target.png]");
  process.exit(2);
}

const src = PNG.sync.read(fs.readFileSync(input));
const outPng = new PNG({ width: w * s, height: h * s });
for (let oy = 0; oy < h * s; oy++) {
  for (let ox = 0; ox < w * s; ox++) {
    const sx = x + Math.floor(ox / s);
    const sy = y + Math.floor(oy / s);
    const si = (sy * src.width + sx) * 4;
    const oi = (oy * outPng.width + ox) * 4;
    outPng.data[oi] = src.data[si];
    outPng.data[oi + 1] = src.data[si + 1];
    outPng.data[oi + 2] = src.data[si + 2];
    outPng.data[oi + 3] = 255;
  }
}
fs.writeFileSync(out, PNG.sync.write(outPng));
console.log(`wrote ${out} (${w * s}x${h * s})`);
