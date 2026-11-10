#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";
import { readHexByte } from "#src/png.js";

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const pngPath = readStringArgument(argumentList, "input") || "target.png";
const png = PNG.sync.read(fs.readFileSync(pngPath));
const { width: W, height: H, data: pixelBytes } = png;

const isBg = (column: number, y: number) => {
  const bytesPerPixel = 4;

  const i = (y * W + column) * bytesPerPixel;
  const blueChannelOffset = 2;

  const nearWhiteRedChannelFloor = 240;

  const nearWhiteGreenChannelFloor = 240;

  const nearWhiteBlueChannelFloor = 240;

  return (
    pixelBytes[i] > nearWhiteRedChannelFloor &&
    pixelBytes[i + 1] > nearWhiteGreenChannelFloor &&
    pixelBytes[i + blueChannelOffset] > nearWhiteBlueChannelFloor
  );
};
const readHexColorAt = (column: number, y: number) => {
  const bytesPerPixel = 4;

  const i = (y * W + column) * bytesPerPixel;
  const blueChannelOffset = 2;

  return readHexByte(pixelBytes[i], pixelBytes[i + 1], pixelBytes[i + blueChannelOffset]);
};

const columnCounts = new Array<number>(W).fill(0);
for (let column = 0; column < W; column++) {
  let c = 0;
  for (let y = 0; y < H; y++) {
    const isForegroundPixel = !isBg(column, y);
    if (isForegroundPixel) c++;
  }
  columnCounts[column] = c;
}

const GAP = 25;
const bands: [number, number][] = [];
let start = -1;
let emptyRun = 0;
for (let column = 0; column <= W; column++) {
  const hasOpenRun = column < W && columnCounts[column] > 1;

  if (hasOpenRun) {
    const isRunNotStarted = start === -1;
    if (isRunNotStarted) start = column;

    emptyRun = 0;
  } else {
    emptyRun++;

    const isRunEnding = start !== -1 && (emptyRun >= GAP || column === W);
    if (isRunEnding) {
      bands.push([start, column - emptyRun]);
      start = -1;
    }
  }
}

const backgroundSampleColumn = 4;

const backgroundSampleLineIndex = 4;

const regionMap: Record<string, unknown> = {
  background: readHexColorAt(backgroundSampleColumn, backgroundSampleLineIndex),
  dimensions: { W, H },
  bands: [] as unknown[],
};
for (const [x0, x1] of bands) {
  let yTop = H;
  let yBot = 0;
  const colorCounts = new Map<string, number>();
  for (let y = 0; y < H; y++) {
    for (let column = x0; column <= x1; column++) {
      if (isBg(column, y)) continue;

      const isAboveRegion = y < yTop;
      if (isAboveRegion) yTop = y;

      const isBelowRegion = y > yBot;
      if (isBelowRegion) yBot = y;

      const bytesPerPixel = 4;

      const i = (y * W + column) * bytesPerPixel;
      const hexRadix = 16;

      const channelHighNibbleMask = 0xf0;

      const blueChannelOffsetForKey = 2;

      const greenChannelHighNibbleMask = 0xf0;

      const blueChannelHighNibbleMask = 0xf0;

      const hexByteDigitCount = 2;

      const key = `#${[pixelBytes[i] & channelHighNibbleMask, pixelBytes[i + 1] & greenChannelHighNibbleMask, pixelBytes[i + blueChannelOffsetForKey] & blueChannelHighNibbleMask].map((v) => v.toString(hexRadix).padStart(hexByteDigitCount, "0")).join("")}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }
  }
  const topRegionCount = 3;

  const topColors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topRegionCount)
    .map(([h]) => h);
  (regionMap.bands as unknown[]).push({
    bbox: { column: x0, y: yTop, w: x1 - x0 + 1, h: yBot - yTop + 1 },
    colors: topColors,
  });
}

const indentSpaceCount = 2;

console.log(JSON.stringify(regionMap, null, indentSpaceCount));
