#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";

const BYTES_PER_PIXEL = 4;

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const pngPath = readStringArgument(argumentList, "input") || "design.png";
const png = PNG.sync.read(fs.readFileSync(pngPath));
const { width, height, data: pixelBytes } = png;

const isViolet = (byteOffset: number) => {
  const blueChannelOffset = 2;

  const red = pixelBytes[byteOffset],
    green = pixelBytes[byteOffset + 1],
    blue = pixelBytes[byteOffset + blueChannelOffset];
  const minimumBlueRedGap = 10;

  const minimumRedGreenGap = 20;

  const maximumRedChannel = 232;

  const minimumRedChannel = 100;

  const minimumBlueChannel = 150;

  return (
    blue > minimumBlueChannel &&
    red > minimumRedChannel &&
    red < maximumRedChannel &&
    green < red - minimumRedGreenGap &&
    blue > red + minimumBlueRedGap
  );
};

const seen = new Uint8Array(width * height);
const violetBlobs: { area: number; cx: number; cy: number; bbox: { x: number; y: number; w: number; h: number } }[] =
  [];
const stack: number[] = [];
for (let y = 0; y < height; y++) {
  for (let column = 0; column < width; column++) {
    const pixelIndex = y * width + column;

    const isSkippedPixel = seen[pixelIndex] || !isViolet(pixelIndex * BYTES_PER_PIXEL);
    if (isSkippedPixel) continue;

    stack.length = 0;
    stack.push(pixelIndex);
    seen[pixelIndex] = 1;
    let minHorizontal = column,
      maxHorizontal = column,
      minY = y,
      maxY = y,
      area = 0,
      sumX = 0,
      sumY = 0;
    while (stack.length) {
      const currentPixelIndex = stack.pop()!;
      const currentX = currentPixelIndex % width,
        currentY = (currentPixelIndex / width) | 0;
      area++;
      sumX += currentX;
      sumY += currentY;

      const isLeftOfBounds = currentX < minHorizontal;
      if (isLeftOfBounds) minHorizontal = currentX;

      const isRightOfBounds = currentX > maxHorizontal;
      if (isRightOfBounds) maxHorizontal = currentX;

      const isAboveBounds = currentY < minY;
      if (isAboveBounds) minY = currentY;

      const isBelowBounds = currentY > maxY;
      if (isBelowBounds) maxY = currentY;

      const neighborPixelIndexes = [
        currentPixelIndex - 1,
        currentPixelIndex + 1,
        currentPixelIndex - width,
        currentPixelIndex + width,
      ];
      for (const neighborPixelIndex of neighborPixelIndexes) {
        const isOutsideImageOrSeen =
          neighborPixelIndex < 0 || neighborPixelIndex >= width * height || seen[neighborPixelIndex];
        if (isOutsideImageOrSeen) continue;

        const neighborX = neighborPixelIndex % width;

        const isScanlineWrapStep = Math.abs(neighborX - currentX) > 1;
        if (isScanlineWrapStep) continue;

        if (isViolet(neighborPixelIndex * BYTES_PER_PIXEL)) {
          seen[neighborPixelIndex] = 1;
          stack.push(neighborPixelIndex);
        }
      }
    }

    const minimumBlobPixelCount = 40;

    const isLargeEnoughBlob = area >= minimumBlobPixelCount;
    if (isLargeEnoughBlob)
      violetBlobs.push({
        area,
        cx: Math.round(sumX / area),
        cy: Math.round(sumY / area),
        bbox: { x: minHorizontal, y: minY, w: maxHorizontal - minHorizontal + 1, h: maxY - minY + 1 },
      });
  }
}
violetBlobs.sort((firstBlob, secondBlob) => secondBlob.area - firstBlob.area);
const indentSpaceCount = 2;

console.log(JSON.stringify(violetBlobs, null, indentSpaceCount));
