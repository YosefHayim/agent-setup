#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";

const NEIGHBOR_DIRECTION_COUNT = 8;

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const pngPath = readStringArgument(argumentList, "input") || "out/hand.png";
const svgPath = readStringArgument(argumentList, "output") || "out/hand-clip.svg";

const { width, height, data: pixelBytes } = PNG.sync.read(fs.readFileSync(pngPath));

const wall = new Uint8Array(width * height);
for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex++) {
  const bytesPerPixel = 4;

  const pixelOffset = pixelIndex * bytesPerPixel;

  const darkPixelLumaLimit = 120;

  const blueChannelOffset = 2;

  const blueLumaWeight = 0.114;

  const greenLumaWeight = 0.587;

  const redLumaWeight = 0.299;

  const isDarkPixel =
    redLumaWeight * pixelBytes[pixelOffset] +
      greenLumaWeight * pixelBytes[pixelOffset + 1] +
      blueLumaWeight * pixelBytes[pixelOffset + blueChannelOffset] <
    darkPixelLumaLimit;
  if (isDarkPixel) wall[pixelIndex] = 1;
}

const stampWall = (column: number, y: number, radius: number) => {
  for (let deltaY = -radius; deltaY <= radius; deltaY++)
    for (let deltaX = -radius; deltaX <= radius; deltaX++) {
      const neighborColumn = column + deltaX,
        neighborRow = y + deltaY;

      const isInsideImage = neighborColumn >= 0 && neighborRow >= 0 && neighborColumn < width && neighborRow < height;
      if (isInsideImage) wall[neighborRow * width + neighborColumn] = 1;
    }
};

const WRIST_ARC: [number, number][] = [
  [443, 540],
  [433, 612],
  [407, 658],
  [358, 677],
  [312, 657],
  [285, 608],
  [284, 535],
];
for (let k = 0; k + 1 < WRIST_ARC.length; k++) {
  const [arcStartX, arcStartY] = WRIST_ARC[k],
    [arcEndX, arcEndY] = WRIST_ARC[k + 1];
  const stepCount = Math.ceil(Math.hypot(arcEndX - arcStartX, arcEndY - arcStartY));
  const wallStrokeRadius = 3;

  for (let stepIndex = 0; stepIndex <= stepCount; stepIndex++)
    stampWall(
      Math.round(arcStartX + ((arcEndX - arcStartX) * stepIndex) / stepCount),
      Math.round(arcStartY + ((arcEndY - arcStartY) * stepIndex) / stepCount),
      wallStrokeRadius,
    );
}

const nearWallPixels = new Uint8Array(width * height);
for (let y = 0; y < height; y++)
  for (let column = 0; column < width; column++) {
    const isOpenPixel = !wall[y * width + column];
    if (isOpenPixel) continue;

    const stampColumnMaximumOffset = 2;

    const stampMaximumVerticalOffset = 2;

    for (let deltaY = -2; deltaY <= stampMaximumVerticalOffset; deltaY++)
      for (let deltaX = -2; deltaX <= stampColumnMaximumOffset; deltaX++) {
        const neighborColumn = column + deltaX,
          neighborRow = y + deltaY;

        const isNeighborInsideImage =
          neighborColumn >= 0 && neighborRow >= 0 && neighborColumn < width && neighborRow < height;
        if (isNeighborInsideImage) nearWallPixels[neighborRow * width + neighborColumn] = 1;
      }
  }

const outsideMask = new Uint8Array(width * height);
const stack: number[] = [];
for (let column = 0; column < width; column++) {
  stack.push(column);
  stack.push((height - 1) * width + column);
}
for (let y = 0; y < height; y++) {
  stack.push(y * width);
  stack.push(y * width + width - 1);
}
while (stack.length) {
  const filledPixelIndex = stack.pop()!;

  const isEdgeOrRingPixel = outsideMask[filledPixelIndex] || nearWallPixels[filledPixelIndex];
  if (isEdgeOrRingPixel) continue;

  outsideMask[filledPixelIndex] = 1;

  const column = filledPixelIndex % width,
    y = (filledPixelIndex / width) | 0;

  const hasLeftNeighbor = column > 0;
  if (hasLeftNeighbor) stack.push(filledPixelIndex - 1);

  const hasRightNeighbor = column < width - 1;
  if (hasRightNeighbor) stack.push(filledPixelIndex + 1);

  const hasUpNeighbor = y > 0;
  if (hasUpNeighbor) stack.push(filledPixelIndex - width);

  const hasDownNeighbor = y < height - 1;
  if (hasDownNeighbor) stack.push(filledPixelIndex + width);
}
const silhouette = new Uint8Array(width * height);
for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex++) {
  const isExtendedPixel = outsideMask[pixelIndex] === 1;
  silhouette[pixelIndex] = isExtendedPixel ? 0 : 1;
}

const traceContour = () => {
  let start = -1;
  for (let pixelIndex = 0; pixelIndex < silhouette.length && start < 0; pixelIndex++) {
    const isSilhouettePixel = silhouette[pixelIndex] === 1;
    if (isSilhouettePixel) start = pixelIndex;
  }
  const startX = start % width,
    startY = (start / width) | 0;
  const isSilhouetteAt = (column: number, y: number) =>
    column >= 0 && y >= 0 && column < width && y < height && silhouette[y * width + column] === 1;
  const neighborOffsets = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const contourPoints: [number, number][] = [[startX, startY]];
  let currentX = startX,
    currentY = startY,
    direction = 6;
  const maxSteps = silhouette.length * NEIGHBOR_DIRECTION_COUNT;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < NEIGHBOR_DIRECTION_COUNT; k++) {
      const nextDirection = (direction + k) % NEIGHBOR_DIRECTION_COUNT;

      const neighborX = currentX + neighborOffsets[nextDirection][0],
        neighborY = currentY + neighborOffsets[nextDirection][1];

      const isNeighborOn = isSilhouetteAt(neighborX, neighborY);
      if (isNeighborOn) {
        currentX = neighborX;
        currentY = neighborY;
        contourPoints.push([currentX, currentY]);
        const backtrackDirectionOffset = 5;

        direction = (nextDirection + backtrackDirectionOffset) % NEIGHBOR_DIRECTION_COUNT;
        found = true;
        break;
      }
    }

    const isNoNextStepFound = !found;
    if (isNoNextStepFound) break;

    const minimumClosedPointCount = 2;

    const isBackAtStart = currentX === startX && currentY === startY && contourPoints.length > minimumClosedPointCount;
    if (isBackAtStart) break;
  }
  return contourPoints;
};

const simplify = (points: [number, number][], tolerance: number): [number, number][] => {
  const minimumContourPointCount = 3;

  const isTooFewPoints = points.length < minimumContourPointCount;
  if (isTooFewPoints) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const segments: [number, number][] = [[0, points.length - 1]];
  while (segments.length) {
    const [startIndex, endIndex] = segments.pop()!;
    const [startX, startY] = points[startIndex],
      [endX, endY] = points[endIndex];
    let farthestDistance = -1,
      farthestIndex = -1;
    const deltaX = endX - startX,
      deltaY = endY - startY;
    const segmentLength = Math.hypot(deltaX, deltaY) || 1;
    for (let i = startIndex + 1; i < endIndex; i++) {
      const [pointX, pointY] = points[i];

      const distance = Math.abs((pointX - startX) * deltaY - (pointY - startY) * deltaX) / segmentLength;

      const isFarthestSoFar = distance > farthestDistance;
      if (isFarthestSoFar) {
        farthestDistance = distance;
        farthestIndex = i;
      }
    }

    const isFarEnoughToSplit = farthestDistance > tolerance && farthestIndex > 0;
    if (isFarEnoughToSplit) {
      keep[farthestIndex] = 1;
      segments.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }
  return points.filter((_, index) => keep[index]);
};

const simplifyClosed = (points: [number, number][], tolerance: number): [number, number][] => {
  const last = points[points.length - 1];

  const isRingAlreadyClosed = points.length > 1 && points[0][0] === last[0] && points[0][1] === last[1];
  const openContour = isRingAlreadyClosed ? points.slice(0, -1) : points;

  const minimumRingPointCount = 4;

  const isTooSmallOpenContour = openContour.length < minimumRingPointCount;
  if (isTooSmallOpenContour) return openContour;

  let farthestIndex = 0,
    farthestDistance = -1;
  for (let i = 1; i < openContour.length; i++) {
    const distance = Math.hypot(openContour[i][0] - openContour[0][0], openContour[i][1] - openContour[0][1]);

    const isFartherThanCurrentBest = distance > farthestDistance;
    if (isFartherThanCurrentBest) {
      farthestDistance = distance;
      farthestIndex = i;
    }
  }
  const first = simplify(openContour.slice(0, farthestIndex + 1), tolerance);
  const second = simplify(openContour.slice(farthestIndex).concat([openContour[0]]), tolerance);
  return first.concat(second.slice(1, -1));
};

const simplifyToleranceDistance = 1.5;

const contour = simplifyClosed(traceContour(), simplifyToleranceDistance);
const pathSegments = contour.map(([column, y], index) => {
  const isFirstPoint = index === 0;
  return `${isFirstPoint ? "M" : "L"}${column},${y}`;
});
const pathData = `${pathSegments.join(" ")} Z`;
fs.mkdirSync(path.dirname(svgPath), { recursive: true });
fs.writeFileSync(
  svgPath,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n<path d="${pathData}"/>\n</svg>`,
);

let area = 0;
for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex++) area += silhouette[pixelIndex];
console.log(`silhouette ${area}px | contour points ${contour.length} | wrote ${svgPath}`);
