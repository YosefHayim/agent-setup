#!/usr/bin/env node
import fs from "node:fs";
/** Find saturated-violet clusters (sparkles + eyes) via connected components. */
import { PNG } from "pngjs";
import { argString, parseArgs } from "../lib/argv.js";

const args = parseArgs(process.argv.slice(2));
const input = argString(args, "input") || "design.png";
const png = PNG.sync.read(fs.readFileSync(input));
const { width: W, height: H, data: pixelBytes } = png;

const isViolet = (i: number) => {
  const r = pixelBytes[i],
    g = pixelBytes[i + 1],
    b = pixelBytes[i + 2];
  return b > 150 && r > 100 && r < 232 && g < r - 20 && b > r + 10;
};

const seen = new Uint8Array(W * H);
const comps: { area: number; cx: number; cy: number; bbox: { x: number; y: number; w: number; h: number } }[] = [];
const stack: number[] = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (seen[p] || !isViolet(p * 4)) continue;
    stack.length = 0;
    stack.push(p);
    seen[p] = 1;
    let minX = x,
      maxX = x,
      minY = y,
      maxY = y,
      area = 0,
      sx = 0,
      sy = 0;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % W,
        qy = (q / W) | 0;
      area++;
      sx += qx;
      sy += qy;
      if (qx < minX) minX = qx;
      if (qx > maxX) maxX = qx;
      if (qy < minY) minY = qy;
      if (qy > maxY) maxY = qy;
      const nb = [q - 1, q + 1, q - W, q + W];
      for (const n of nb) {
        if (n < 0 || n >= W * H || seen[n]) continue;
        const nx = n % W;
        if (Math.abs(nx - qx) > 1) continue;
        if (isViolet(n * 4)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (area >= 40)
      comps.push({
        area,
        cx: Math.round(sx / area),
        cy: Math.round(sy / area),
        bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      });
  }
}
comps.sort((a, b) => b.area - a.area);
console.log(JSON.stringify(comps, null, 2));
