#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";
import { readHexByte } from "#src/png.js";

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const pngPath = readStringArgument(argumentList, "input") || "target.png";
const png = PNG.sync.read(fs.readFileSync(pngPath));
const { width, height, data: pixelBytes } = png;

const isBackgroundPixel = (column: number, y: number) => {
  const bytesPerPixel = 4;

  const pixelOffset = (y * width + column) * bytesPerPixel;
  const blueChannelOffset = 2;

  const nearWhiteRedChannelFloor = 240;

  const nearWhiteGreenChannelFloor = 240;

  const nearWhiteBlueChannelFloor = 240;

  return (
    pixelBytes[pixelOffset] > nearWhiteRedChannelFloor &&
    pixelBytes[pixelOffset + 1] > nearWhiteGreenChannelFloor &&
    pixelBytes[pixelOffset + blueChannelOffset] > nearWhiteBlueChannelFloor
  );
};
const readHexColorAt = (column: number, y: number) => {
  const bytesPerPixel = 4;

  const pixelOffset = (y * width + column) * bytesPerPixel;
  const blueChannelOffset = 2;

  return readHexByte(pixelBytes[pixelOffset], pixelBytes[pixelOffset + 1], pixelBytes[pixelOffset + blueChannelOffset]);
};

const columnCounts = new Array<number>(width).fill(0);
for (let column = 0; column < width; column++) {
  let foregroundCount = 0;
  for (let y = 0; y < height; y++) {
    const isForegroundPixel = !isBackgroundPixel(column, y);
    if (isForegroundPixel) foregroundCount++;
  }
  columnCounts[column] = foregroundCount;
}

const GAP = 25;
const bands: [number, number][] = [];
let start = -1;
let emptyRun = 0;
for (let column = 0; column <= width; column++) {
  const hasOpenRun = column < width && columnCounts[column] > 1;

  if (hasOpenRun) {
    const isRunNotStarted = start === -1;
    if (isRunNotStarted) start = column;

    emptyRun = 0;
  } else {
    emptyRun++;

    const isRunEnding = start !== -1 && (emptyRun >= GAP || column === width);
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
  dimensions: { W: width, H: height },
  bands: [] as unknown[],
};
for (const [bandStartColumn, bandEndColumn] of bands) {
  let yTop = height;
  let yBottom = 0;
  const colorCounts = new Map<string, number>();
  for (let y = 0; y < height; y++) {
    for (let column = bandStartColumn; column <= bandEndColumn; column++) {
      if (isBackgroundPixel(column, y)) continue;

      const isAboveRegion = y < yTop;
      if (isAboveRegion) yTop = y;

      const isBelowRegion = y > yBottom;
      if (isBelowRegion) yBottom = y;

      const bytesPerPixel = 4;

      const pixelOffset = (y * width + column) * bytesPerPixel;
      const hexRadix = 16;

      const channelHighNibbleMask = 0xf0;

      const blueChannelOffsetForKey = 2;

      const greenChannelHighNibbleMask = 0xf0;

      const blueChannelHighNibbleMask = 0xf0;

      const hexByteDigitCount = 2;

      const key = `#${[pixelBytes[pixelOffset] & channelHighNibbleMask, pixelBytes[pixelOffset + 1] & greenChannelHighNibbleMask, pixelBytes[pixelOffset + blueChannelOffsetForKey] & blueChannelHighNibbleMask].map((channelValue) => channelValue.toString(hexRadix).padStart(hexByteDigitCount, "0")).join("")}`;
      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }
  }
  const topRegionCount = 3;

  const topColors = [...colorCounts.entries()]
    .sort((firstColorPair, secondColorPair) => secondColorPair[1] - firstColorPair[1])
    .slice(0, topRegionCount)
    .map(([hexColor]) => hexColor);
  (regionMap.bands as unknown[]).push({
    bbox: { column: bandStartColumn, y: yTop, w: bandEndColumn - bandStartColumn + 1, h: yBottom - yTop + 1 },
    colors: topColors,
  });
}

const indentSpaceCount = 2;

console.log(JSON.stringify(regionMap, null, indentSpaceCount));
