#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";

const BYTES_PER_PIXEL = 4;

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const pngPath = readStringArgument(argumentList, "input") || "design.png";
const png = PNG.sync.read(fs.readFileSync(pngPath));
const { width: W, height: H, data: pixelBytes } = png;

const isViolet = (i: number) => {
  const blueChannelOffset = 2;

  const r = pixelBytes[i],
    g = pixelBytes[i + 1],
    b = pixelBytes[i + blueChannelOffset];
  const minimumBlueRedGap = 10;

  const minimumRedGreenGap = 20;

  const maximumRedChannel = 232;

  const minimumRedChannel = 100;

  const minimumBlueChannel = 150;

  return (
    b > minimumBlueChannel &&
    r > minimumRedChannel &&
    r < maximumRedChannel &&
    g < r - minimumRedGreenGap &&
    b > r + minimumBlueRedGap
  );
};

const seen = new Uint8Array(W * H);
const comps: { area: number; cx: number; cy: number; bbox: { x: number; y: number; w: number; h: number } }[] = [];
const stack: number[] = [];
for (let y = 0; y < H; y++) {
  for (let column = 0; column < W; column++) {
    const p = y * W + column;

    const isSkippedPixel = seen[p] || !isViolet(p * BYTES_PER_PIXEL);
    if (isSkippedPixel) continue;

    stack.length = 0;
    stack.push(p);
    seen[p] = 1;
    let minHorizontal = column,
      maxHorizontal = column,
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

      const isLeftOfBounds = qx < minHorizontal;
      if (isLeftOfBounds) minHorizontal = qx;

      const isRightOfBounds = qx > maxHorizontal;
      if (isRightOfBounds) maxHorizontal = qx;

      const isAboveBounds = qy < minY;
      if (isAboveBounds) minY = qy;

      const isBelowBounds = qy > maxY;
      if (isBelowBounds) maxY = qy;

      const nb = [q - 1, q + 1, q - W, q + W];
      for (const n of nb) {
        const isOutsideImageOrSeen = n < 0 || n >= W * H || seen[n];
        if (isOutsideImageOrSeen) continue;

        const nx = n % W;

        const isScanlineWrapStep = Math.abs(nx - qx) > 1;
        if (isScanlineWrapStep) continue;

        if (isViolet(n * BYTES_PER_PIXEL)) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }

    const minimumBlobPixelCount = 40;

    const isLargeEnoughBlob = area >= minimumBlobPixelCount;
    if (isLargeEnoughBlob)
      comps.push({
        area,
        cx: Math.round(sx / area),
        cy: Math.round(sy / area),
        bbox: { x: minHorizontal, y: minY, w: maxHorizontal - minHorizontal + 1, h: maxY - minY + 1 },
      });
  }
}
comps.sort((a, b) => b.area - a.area);
const indentSpaceCount = 2;

console.log(JSON.stringify(comps, null, indentSpaceCount));
