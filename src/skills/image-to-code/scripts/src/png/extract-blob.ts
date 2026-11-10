#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { parseArgumentList, readStringArgument } from "#src/argv.js";

const SPACE_SEPARATOR = " ";

const NEIGHBOR_DIRECTION_COUNT = 8;

const NEAR_WHITE_CHANNEL_FLOOR = 250;

const firstArgumentIndex = 2;

const argumentList = parseArgumentList(process.argv.slice(firstArgumentIndex));
const pngPath = readStringArgument(argumentList, "input") || "design.png";
const svgPath = readStringArgument(argumentList, "output") || "out/blob.svg";

const image = PNG.sync.read(fs.readFileSync(pngPath));
const { width, height } = image;

const isLavender = (column: number, y: number) => {
  const bytesPerPixel = 4;

  const pixelOffset = (y * width + column) * bytesPerPixel;

  const blueChannelOffset = 2;

  const red = image.data[pixelOffset],
    green = image.data[pixelOffset + 1],
    blue = image.data[pixelOffset + blueChannelOffset];

  const brightChannelFloor = 205;

  const isNotBrightEnough = Math.min(red, green, blue) < brightChannelFloor;
  if (isNotBrightEnough) return false;

  const isNearWhite =
    red > NEAR_WHITE_CHANNEL_FLOOR && green > NEAR_WHITE_CHANNEL_FLOOR && blue > NEAR_WHITE_CHANNEL_FLOOR;
  if (isNearWhite) return false;

  const blueOverRedMargin = 2;

  const blueOverGreenMargin = 4;

  return blue > green + blueOverGreenMargin && blue >= red - blueOverRedMargin;
};

const CELL_SIZE = 3;
const gridWidth = Math.ceil(width / CELL_SIZE),
  gridHeight = Math.ceil(height / CELL_SIZE);
const grid = new Uint8Array(gridWidth * gridHeight);
for (let gridRow = 0; gridRow < gridHeight; gridRow++) {
  for (let gridColumn = 0; gridColumn < gridWidth; gridColumn++) {
    let hits = 0,
      total = 0;
    for (let deltaY = 0; deltaY < CELL_SIZE; deltaY++) {
      for (let deltaX = 0; deltaX < CELL_SIZE; deltaX++) {
        const column = gridColumn * CELL_SIZE + deltaX,
          y = gridRow * CELL_SIZE + deltaY;

        const isOutsideImage = column >= width || y >= height;
        if (isOutsideImage) continue;

        total++;

        if (isLavender(column, y)) hits++;
      }
    }

    const quarterFractionDenominator = 4;

    const isAtLeastQuarterFilled = hits * quarterFractionDenominator >= total;
    if (isAtLeastQuarterFilled) grid[gridRow * gridWidth + gridColumn] = 1;
  }
}

const componentIds = new Int32Array(gridWidth * gridHeight).fill(0);
const componentArea: Record<number, number> = {};
let componentCount = 0;
const stack: number[] = [];
for (let cellIndex = 0; cellIndex < gridWidth * gridHeight; cellIndex++) {
  const isSkippedCell = !grid[cellIndex] || componentIds[cellIndex];
  if (isSkippedCell) continue;

  componentCount++;
  componentIds[cellIndex] = componentCount;
  stack.length = 0;
  stack.push(cellIndex);
  let area = 0;
  while (stack.length) {
    const filledCellIndex = stack.pop()!;
    area++;
    const gridColumn = filledCellIndex % gridWidth,
      gridRow = (filledCellIndex / gridWidth) | 0;
    for (let deltaY = -1; deltaY <= 1; deltaY++) {
      for (let deltaX = -1; deltaX <= 1; deltaX++) {
        const neighborColumn = gridColumn + deltaX,
          neighborRow = gridRow + deltaY;

        const isOutsideGrid =
          neighborColumn < 0 || neighborRow < 0 || neighborColumn >= gridWidth || neighborRow >= gridHeight;
        if (isOutsideGrid) continue;

        const neighborCellIndex = neighborRow * gridWidth + neighborColumn;

        const isUnvisitedFilledCell = grid[neighborCellIndex] && !componentIds[neighborCellIndex];
        if (isUnvisitedFilledCell) {
          componentIds[neighborCellIndex] = componentCount;
          stack.push(neighborCellIndex);
        }
      }
    }
  }
  componentArea[componentCount] = area;
}

const traceContour = (id: number): [number, number][] => {
  let start = -1;
  for (let cellIndex = 0; cellIndex < grid.length && start < 0; cellIndex++) {
    const isPixelInComponent = componentIds[cellIndex] === id;
    if (isPixelInComponent) start = cellIndex;
  }
  const startX = start % gridWidth,
    startY = (start / gridWidth) | 0;
  const isInsideComponent = (column: number, y: number) =>
    column >= 0 && y >= 0 && column < gridWidth && y < gridHeight && componentIds[y * gridWidth + column] === id;
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
  const maxSteps = grid.length * NEIGHBOR_DIRECTION_COUNT;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < NEIGHBOR_DIRECTION_COUNT; k++) {
      const nextDirection = (direction + k) % NEIGHBOR_DIRECTION_COUNT;

      const neighborX = currentX + neighborOffsets[nextDirection][0],
        neighborY = currentY + neighborOffsets[nextDirection][1];

      const isNeighborInComponent = isInsideComponent(neighborX, neighborY);
      if (isNeighborInComponent) {
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

    const minimumBackAtStartPointCount = 2;

    const isBackAtStart =
      currentX === startX && currentY === startY && contourPoints.length > minimumBackAtStartPointCount;
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
  const isRingAlreadyClosed =
    points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
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

const MIN_AREA = 60;
const subpaths: string[] = [];
let kept = 0;
for (let id = 1; id <= componentCount; id++) {
  const isComponentTooSmall = componentArea[id] < MIN_AREA;
  if (isComponentTooSmall) continue;

  const tracedContour = traceContour(id);

  const simplifyToleranceDistance = 1.4;

  const simp = simplifyClosed(tracedContour, simplifyToleranceDistance);

  const minimumSimplifiedPointCount = 3;

  const isSimplifiedTooSmall = simp.length < minimumSimplifiedPointCount;
  if (isSimplifiedTooSmall) continue;

  kept++;
  const subpathData = simp
    .map(([column, y], index) => {
      const isFirstPoint = index === 0;
      return `${isFirstPoint ? "M" : "L"}${(column * CELL_SIZE).toFixed(0)},${(y * CELL_SIZE).toFixed(0)}`;
    })
    .join(SPACE_SEPARATOR);
  subpaths.push(`${subpathData} Z`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
<path d="${subpaths.join(SPACE_SEPARATOR)}" fill="#f4edfd"/>
</svg>`;
fs.mkdirSync(path.dirname(svgPath), { recursive: true });
fs.writeFileSync(svgPath, svg);
console.log(
  `grid ${gridWidth}x${gridHeight} | components ${componentCount} | kept ${kept} | path chars ${subpaths.join(SPACE_SEPARATOR).length}`,
);
