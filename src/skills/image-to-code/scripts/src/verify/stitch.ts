#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";

const ALPHA_CHANNEL_OFFSET = 3;

const MAX_CHANNEL_LEVEL = 255;

const BYTES_PER_PIXEL = 4;

const firstArgumentIndex = 2;

const [leftPath, rightPath, outPath] = process.argv.slice(firstArgumentIndex);

const isStitchPathMissing = !leftPath || !rightPath || !outPath;
if (isStitchPathMissing) {
  console.error("usage: tsx src/verify/stitch.ts <left.png> <right.png> <out.png>");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const TILE_SIZE = 460;
const GAP = 24;
const load = (pngPath: string) => PNG.sync.read(fs.readFileSync(pngPath));
const scale = (sourcePng: PNG) => {
  const scaledPng = new PNG({ width: TILE_SIZE, height: TILE_SIZE });
  for (let y = 0; y < TILE_SIZE; y++)
    for (let column = 0; column < TILE_SIZE; column++) {
      const sourceX = Math.floor((column * sourcePng.width) / TILE_SIZE);
      const sourceY = Math.floor((y * sourcePng.height) / TILE_SIZE);
      const sourceOffset = (sourceY * sourcePng.width + sourceX) * BYTES_PER_PIXEL;
      const scaledOffset = (y * TILE_SIZE + column) * BYTES_PER_PIXEL;
      scaledPng.data[scaledOffset] = sourcePng.data[sourceOffset];
      scaledPng.data[scaledOffset + 1] = sourcePng.data[sourceOffset + 1];
      const blueChannelOffset = 2;

      const blueByteOffsetInPixel = 2;

      scaledPng.data[scaledOffset + blueChannelOffset] = sourcePng.data[sourceOffset + blueByteOffsetInPixel];
      scaledPng.data[scaledOffset + ALPHA_CHANNEL_OFFSET] = MAX_CHANNEL_LEVEL;
    }
  return scaledPng;
};
const leftTile = scale(load(leftPath));
const rightTile = scale(load(rightPath));
const stitchedWidth = TILE_SIZE * 2 + GAP;
const stitched = new PNG({ width: stitchedWidth, height: TILE_SIZE });
stitched.data.fill(MAX_CHANNEL_LEVEL);
const paste = (tile: PNG, offsetX: number) => {
  for (let y = 0; y < TILE_SIZE; y++)
    for (let column = 0; column < TILE_SIZE; column++) {
      const tileOffset = (y * TILE_SIZE + column) * BYTES_PER_PIXEL;
      const stitchedOffset = (y * stitchedWidth + (column + offsetX)) * BYTES_PER_PIXEL;
      stitched.data[stitchedOffset] = tile.data[tileOffset];
      stitched.data[stitchedOffset + 1] = tile.data[tileOffset + 1];
      const blueChannelOffsetInStitched = 2;

      const imageBlueChannelOffset = 2;

      stitched.data[stitchedOffset + blueChannelOffsetInStitched] = tile.data[tileOffset + imageBlueChannelOffset];
      stitched.data[stitchedOffset + ALPHA_CHANNEL_OFFSET] = MAX_CHANNEL_LEVEL;
    }
};
paste(leftTile, 0);
paste(rightTile, TILE_SIZE + GAP);
fs.writeFileSync(outPath, PNG.sync.write(stitched));
console.log("wrote", outPath);
