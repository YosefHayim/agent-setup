#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
/**
 * Read a target PNG's dimensions, sample hex colors at pixels, and/or report a palette.
 */
import { PNG } from "pngjs";
import { argString, parseArgs } from "#src/argv.js";
import { colorAt, toHex } from "#src/png.js";

const args = parseArgs(process.argv.slice(2), { repeat: ["at"] });
const inputArg = argString(args, "input");
if (!inputArg) {
  console.error("usage: tsx src/bin/inspect-png.ts --input <file.png> [--at x,y ...] [--palette N]");
  process.exit(2);
}

const file = path.resolve(inputArg);
const png = PNG.sync.read(fs.readFileSync(file));

const out: Record<string, unknown> = { file, width: png.width, height: png.height };

const atList = args.at;
if (Array.isArray(atList) && atList.length) {
  out.samples = atList.map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return colorAt(png, x, y);
  });
}

if (args.palette) {
  const n = Number(args.palette) || 8;
  const counts = new Map<number, number>();
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 8) continue;
    const r = png.data[i] & 0xf8;
    const g = png.data[i + 1] & 0xf8;
    const b = png.data[i + 2] & 0xf8;
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  out.palette = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({
      hex: toHex((key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff),
      pct: +((count / total) * 100).toFixed(1),
    }));
}

console.log(JSON.stringify(out, null, 2));
