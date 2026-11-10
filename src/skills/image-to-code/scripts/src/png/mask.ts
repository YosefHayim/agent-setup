#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";
import { isPointInPolygon, readRgbFromHex } from "#src/png.js";
import type { MaskSettings } from "#src/types.js";

const MAX_CHANNEL_LEVEL = 255;

const WHITE_RGB: [number, number, number] = [MAX_CHANNEL_LEVEL, MAX_CHANNEL_LEVEL, MAX_CHANNEL_LEVEL];

const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;

const settingsPath = process.argv[2];

const isSettingsPathMissing = !settingsPath;
if (isSettingsPathMissing) {
  console.error("usage: tsx src/png/mask.ts <config.json>");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const maskSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as MaskSettings;
const sourcePng = PNG.sync.read(fs.readFileSync(maskSettings.input));
const { width: imageWidth, height: imageHeight, data: pixelBytes } = sourcePng;

const polygon = maskSettings.polygon;
const isKeepMode = maskSettings.mode === "keep";

const isPolygonGiven = (polygonPoints: [number, number][] | undefined): polygonPoints is [number, number][] =>
  polygonPoints != null;
const isColorGiven = (color: string | undefined): color is string => color != null && color !== "";

const readOutsideRgb = (outsideColor: string | undefined): [number, number, number] =>
  isColorGiven(outsideColor) ? readRgbFromHex(outsideColor) : WHITE_RGB;

const readBoxRgb = (pointX: number, pointY: number): [number, number, number] | null => {
  for (const box of maskSettings.boxes ?? []) {
    const [left, top, width, height, color] = box;

    const isPointInsideBox = pointX >= left && pointX < left + width && pointY >= top && pointY < top + height;
    if (isPointInsideBox) return isColorGiven(color) ? readRgbFromHex(color) : WHITE_RGB;
  }
  return null;
};

const readPaintRgb = (pointX: number, pointY: number, isInsidePolygon: boolean): [number, number, number] | null => {
  if (isKeepMode) return isInsidePolygon ? null : readOutsideRgb(maskSettings.outsideColor);

  if (isInsidePolygon) return WHITE_RGB;
  return readBoxRgb(pointX, pointY);
};

const paint = (pixelStart: number, rgb: [number, number, number]) => {
  pixelBytes[pixelStart] = rgb[0];
  pixelBytes[pixelStart + GREEN_OFFSET] = rgb[1];
  pixelBytes[pixelStart + BLUE_OFFSET] = rgb[2];
  pixelBytes[pixelStart + ALPHA_OFFSET] = MAX_CHANNEL_LEVEL;
};

for (let pointY = 0; pointY < imageHeight; pointY++) {
  for (let pointX = 0; pointX < imageWidth; pointX++) {
    const pixelStart = (pointY * imageWidth + pointX) * BYTES_PER_PIXEL;

    const isInsidePolygon = isPolygonGiven(polygon) && isPointInPolygon(pointX, pointY, polygon);
    const paintRgb = readPaintRgb(pointX, pointY, isInsidePolygon);

    const hasPaintRgb = paintRgb != null;
    if (hasPaintRgb) paint(pixelStart, paintRgb);
  }
}

fs.writeFileSync(maskSettings.output, PNG.sync.write(sourcePng));
console.log(`wrote ${maskSettings.output} (${maskSettings.mode})`);
