#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";
import { readColorAt, readHexByte } from "#src/png.js";

const BYTE_MASK = 0xff;

const RED_SHIFT_BITS = 16;

const CHANNEL_QUANTIZE_MASK = 0xf8;

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex), { repeat: ["at"] });

const pngPathArgument = readStringArgument(argumentList, "input");

const isPngPathArgumentMissing = !pngPathArgument;
if (isPngPathArgumentMissing) {
  console.error("usage: tsx src/bin/inspect-png.ts --input <file.png> [--at x,y ...] [--palette N]");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const file = path.resolve(pngPathArgument);
const png = PNG.sync.read(fs.readFileSync(file));

const report: Record<string, unknown> = { file, width: png.width, height: png.height };

const atList = argumentList.at;

const hasAtList = Array.isArray(atList) && atList.length;
if (hasAtList) {
  report.samples = atList.map((pair) => {
    const [column, y] = pair.split(",").map(Number);
    return readColorAt(png, column, y);
  });
}

const isPaletteRequested = argumentList.palette;
if (isPaletteRequested) {
  const defaultPaletteSize = 8;

  const paletteSize = Number(argumentList.palette) || defaultPaletteSize;
  const counts = new Map<number, number>();
  const bytesPerPixel = 4;

  for (let pixelOffset = 0; pixelOffset < png.data.length; pixelOffset += bytesPerPixel) {
    const nearlyTransparentAlphaLimit = 8;

    const alphaChannelOffset = 3;

    const isNearlyTransparent = png.data[pixelOffset + alphaChannelOffset] < nearlyTransparentAlphaLimit;
    if (isNearlyTransparent) continue;

    const red = png.data[pixelOffset] & CHANNEL_QUANTIZE_MASK;
    const green = png.data[pixelOffset + 1] & CHANNEL_QUANTIZE_MASK;
    const blueChannelOffset = 2;

    const blue = png.data[pixelOffset + blueChannelOffset] & CHANNEL_QUANTIZE_MASK;
    const greenShiftBits = 8;

    const key = (red << RED_SHIFT_BITS) | (green << greenShiftBits) | blue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0) || 1;
  const percentScale = 100;

  const greenExtractShiftBits = 8;

  report.palette = [...counts.entries()]
    .sort((firstColorPair, secondColorPair) => secondColorPair[1] - firstColorPair[1])
    .slice(0, paletteSize)
    .map(([key, count]) => ({
      hex: readHexByte(
        (key >> RED_SHIFT_BITS) & BYTE_MASK,
        (key >> greenExtractShiftBits) & BYTE_MASK,
        key & BYTE_MASK,
      ),
      pct: +((count / total) * percentScale).toFixed(1),
    }));
}

const indentSpaceCount = 2;

console.log(JSON.stringify(report, null, indentSpaceCount));
