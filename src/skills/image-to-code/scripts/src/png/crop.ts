#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";

const BYTES_PER_PIXEL = 4;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
const OPAQUE_ALPHA_LEVEL = 255;

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));

// A missing flag becomes NaN, as it did before readStringArgument returned null.
const cropLeftText = readStringArgument(argumentList, "x");
const cropLeft = Number(cropLeftText ?? Number.NaN);
const cropTopText = readStringArgument(argumentList, "y");
const cropTop = Number(cropTopText ?? Number.NaN);
const cropWidthText = readStringArgument(argumentList, "w");
const cropWidth = Number(cropWidthText ?? Number.NaN);
const cropHeightText = readStringArgument(argumentList, "h");
const cropHeight = Number(cropHeightText ?? Number.NaN);

const defaultScaleFactor = 3;
const scaleFactorText = readStringArgument(argumentList, "scale");
const scaleFactor = Number(scaleFactorText || defaultScaleFactor);

const outPath = readStringArgument(argumentList, "out");
const inputPath = readStringArgument(argumentList, "input") || "target.png";

const isCropArgumentMissing = !Number.isFinite(cropLeft) || !outPath;
if (isCropArgumentMissing) {
  console.error("usage: tsx src/png/crop.ts --x N --y N --w N --h N [--scale 3] --out out.png [--input target.png]");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const sourcePng = PNG.sync.read(fs.readFileSync(inputPath));
const scaledCropPng = new PNG({ width: cropWidth * scaleFactor, height: cropHeight * scaleFactor });

for (let outRow = 0; outRow < cropHeight * scaleFactor; outRow++) {
  for (let outColumn = 0; outColumn < cropWidth * scaleFactor; outColumn++) {
    const originalColumn = cropLeft + Math.floor(outColumn / scaleFactor);
    const originalRow = cropTop + Math.floor(outRow / scaleFactor);

    const originalByteIndex = (originalRow * sourcePng.width + originalColumn) * BYTES_PER_PIXEL;
    const outByteIndex = (outRow * scaledCropPng.width + outColumn) * BYTES_PER_PIXEL;

    scaledCropPng.data[outByteIndex] = sourcePng.data[originalByteIndex];
    scaledCropPng.data[outByteIndex + GREEN_OFFSET] = sourcePng.data[originalByteIndex + GREEN_OFFSET];
    scaledCropPng.data[outByteIndex + BLUE_OFFSET] = sourcePng.data[originalByteIndex + BLUE_OFFSET];
    scaledCropPng.data[outByteIndex + ALPHA_OFFSET] = OPAQUE_ALPHA_LEVEL;
  }
}

fs.writeFileSync(outPath, PNG.sync.write(scaledCropPng));
console.log(`wrote ${outPath} (${cropWidth * scaleFactor}x${cropHeight * scaleFactor})`);
