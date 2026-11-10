#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";
import { isPointInPolygon, readRgbFromHex } from "#src/png.js";
import type { MaskBox, MaskSettings } from "#src/types.js";

const MAX_CHANNEL_LEVEL = 255;

const settingsPath = process.argv[2];

const isSettingsPathMissing = !settingsPath;
if (isSettingsPathMissing) {
  console.error("usage: tsx src/png/mask.ts <config.json>");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const cfg = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as MaskSettings;
const png = PNG.sync.read(fs.readFileSync(cfg.input));
const { width: W, height: H, data: pixelBytes } = png;

const isPolygonGiven = (polygon: [number, number][] | undefined): polygon is [number, number][] => polygon != null;
const isColorGiven = (color: string | undefined): color is string => color != null && color !== "";

const readBoxColor = (px: number, py: number): [number, number, number] | null => {
  for (const box of cfg.boxes || []) {
    const [column, y, w, h, hex] = box as MaskBox;
    const isPixelInsideBox = px >= column && px < column + w && py >= y && py < y + h;
    const hasBoxColor = hex != null && hex !== "";
    if (isPixelInsideBox)
      return hasBoxColor ? readRgbFromHex(hex) : [MAX_CHANNEL_LEVEL, MAX_CHANNEL_LEVEL, MAX_CHANNEL_LEVEL];
  }
  return null;
};

const paint = (i: number, rgb: [number, number, number]) => {
  pixelBytes[i] = rgb[0];
  pixelBytes[i + 1] = rgb[1];
  const blueChannelOffset = 2;

  pixelBytes[i + blueChannelOffset] = rgb[2];
  const alphaChannelOffset = 3;

  pixelBytes[i + alphaChannelOffset] = MAX_CHANNEL_LEVEL;
};

for (let y = 0; y < H; y++) {
  for (let column = 0; column < W; column++) {
    const bytesPerPixel = 4;

    const i = (y * W + column) * bytesPerPixel;
    const polygon = cfg.polygon;
    const isInsidePolygon = isPolygonGiven(polygon) && isPointInPolygon(column, y, polygon);

    const isCfgModeKeep = cfg.mode === "keep";
    if (isCfgModeKeep) {
      const outsideColor = cfg.outsideColor;
      const isOutsidePolygon = !isInsidePolygon;
      if (isOutsidePolygon)
        paint(
          i,
          isColorGiven(outsideColor)
            ? readRgbFromHex(outsideColor)
            : [MAX_CHANNEL_LEVEL, MAX_CHANNEL_LEVEL, MAX_CHANNEL_LEVEL],
        );
    } else {
      if (isInsidePolygon) paint(i, [MAX_CHANNEL_LEVEL, MAX_CHANNEL_LEVEL, MAX_CHANNEL_LEVEL]);
      else {
        const boxColor = readBoxColor(column, y);

        const hasBoxColor = boxColor != null;
        if (hasBoxColor) paint(i, boxColor);
      }
    }
  }
}
fs.writeFileSync(cfg.output, PNG.sync.write(png));
console.log(`wrote ${cfg.output} (${cfg.mode})`);
