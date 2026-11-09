#!/usr/bin/env node
import fs from "node:fs";
/** Mask a PNG by region for isolating animatable layers before tracing. */
import { PNG } from "pngjs";
import { hexToRgb, inPoly } from "../lib/png.js";
import type { MaskBox, MaskConfig } from "../lib/types.js";

const configPath = process.argv[2];
if (!configPath) {
  console.error("usage: tsx src/png/mask.ts <config.json>");
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as MaskConfig;
const png = PNG.sync.read(fs.readFileSync(cfg.input));
const { width: W, height: H, data: pixelBytes } = png;

const boxFill = (px: number, py: number): [number, number, number] | null => {
  for (const box of cfg.boxes || []) {
    const [x, y, w, h, hex] = box as MaskBox;
    if (px >= x && px < x + w && py >= y && py < y + h) return hex ? hexToRgb(hex) : [255, 255, 255];
  }
  return null;
};

const paint = (i: number, rgb: [number, number, number]) => {
  pixelBytes[i] = rgb[0];
  pixelBytes[i + 1] = rgb[1];
  pixelBytes[i + 2] = rgb[2];
  pixelBytes[i + 3] = 255;
};

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const insidePoly = cfg.polygon ? inPoly(x, y, cfg.polygon) : false;
    if (cfg.mode === "keep") {
      if (!insidePoly) paint(i, cfg.outsideColor ? hexToRgb(cfg.outsideColor) : [255, 255, 255]);
    } else {
      if (insidePoly) paint(i, [255, 255, 255]);
      else {
        const fill = boxFill(x, y);
        if (fill) paint(i, fill);
      }
    }
  }
}
fs.writeFileSync(cfg.output, PNG.sync.write(png));
console.log(`wrote ${cfg.output} (${cfg.mode})`);
