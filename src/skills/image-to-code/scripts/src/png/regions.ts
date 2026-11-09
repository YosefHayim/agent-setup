#!/usr/bin/env node
import fs from "node:fs";
/** Locate logo groups on a mostly-white canvas via column/row projection. */
import { PNG } from "pngjs";
import { argString, parseArgs } from "../lib/argv.js";
import { toHex } from "../lib/png.js";

const args = parseArgs(process.argv.slice(2));
const input = argString(args, "input") || "target.png";
const png = PNG.sync.read(fs.readFileSync(input));
const { width: W, height: H, data: pixelBytes } = png;

const isBg = (x: number, y: number) => {
  const i = (y * W + x) * 4;
  return pixelBytes[i] > 240 && pixelBytes[i + 1] > 240 && pixelBytes[i + 2] > 240;
};
const hexAt = (x: number, y: number) => {
  const i = (y * W + x) * 4;
  return toHex(pixelBytes[i], pixelBytes[i + 1], pixelBytes[i + 2]);
};

const col = new Array<number>(W).fill(0);
for (let x = 0; x < W; x++) {
  let c = 0;
  for (let y = 0; y < H; y++) if (!isBg(x, y)) c++;
  col[x] = c;
}

const GAP = 25;
const bands: [number, number][] = [];
let start = -1;
let emptyRun = 0;
for (let x = 0; x <= W; x++) {
  const has = x < W && col[x] > 1;
  if (has) {
    if (start === -1) start = x;
    emptyRun = 0;
  } else {
    emptyRun++;
    if (start !== -1 && (emptyRun >= GAP || x === W)) {
      bands.push([start, x - emptyRun]);
      start = -1;
    }
  }
}

const regionMap: Record<string, unknown> = {
  background: hexAt(4, 4),
  dimensions: { W, H },
  bands: [] as unknown[],
};
for (const [x0, x1] of bands) {
  let yTop = H;
  let yBot = 0;
  const colorCounts = new Map<string, number>();
  for (let y = 0; y < H; y++) {
    for (let x = x0; x <= x1; x++) {
      if (isBg(x, y)) continue;
      if (y < yTop) yTop = y;
      if (y > yBot) yBot = y;
      const i = (y * W + x) * 4;
      const key = `#${[pixelBytes[i] & 0xf0, pixelBytes[i + 1] & 0xf0, pixelBytes[i + 2] & 0xf0].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }
  }
  const topColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => h);
  (regionMap.bands as unknown[]).push({
    bbox: { x: x0, y: yTop, w: x1 - x0 + 1, h: yBot - yTop + 1 },
    colors: topColors,
  });
}

console.log(JSON.stringify(regionMap, null, 2));
