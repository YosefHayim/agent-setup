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

const { width: W, height: H, data: pixelBytes } = PNG.sync.read(fs.readFileSync(pngPath));

const wall = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  const bytesPerPixel = 4;

  const i = p * bytesPerPixel;

  const darkPixelLumaLimit = 120;

  const blueChannelOffset = 2;

  const blueLumaWeight = 0.114;

  const greenLumaWeight = 0.587;

  const redLumaWeight = 0.299;

  const isDarkPixel =
    redLumaWeight * pixelBytes[i] +
      greenLumaWeight * pixelBytes[i + 1] +
      blueLumaWeight * pixelBytes[i + blueChannelOffset] <
    darkPixelLumaLimit;
  if (isDarkPixel) wall[p] = 1;
}

const stampWall = (column: number, y: number, radius: number) => {
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = column + dx,
        ny = y + dy;

      const isInsideImage = nx >= 0 && ny >= 0 && nx < W && ny < H;
      if (isInsideImage) wall[ny * W + nx] = 1;
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
  const [ax, ay] = WRIST_ARC[k],
    [bx, by] = WRIST_ARC[k + 1];
  const n = Math.ceil(Math.hypot(bx - ax, by - ay));
  const wallStrokeRadius = 3;

  for (let s = 0; s <= n; s++)
    stampWall(Math.round(ax + ((bx - ax) * s) / n), Math.round(ay + ((by - ay) * s) / n), wallStrokeRadius);
}

const ring = new Uint8Array(W * H);
for (let y = 0; y < H; y++)
  for (let column = 0; column < W; column++) {
    const isOpenPixel = !wall[y * W + column];
    if (isOpenPixel) continue;

    const stampColumnMaximumOffset = 2;

    const stampMaximumVerticalOffset = 2;

    for (let dy = -2; dy <= stampMaximumVerticalOffset; dy++)
      for (let dx = -2; dx <= stampColumnMaximumOffset; dx++) {
        const nx = column + dx,
          ny = y + dy;

        const isNeighborInsideImage = nx >= 0 && ny >= 0 && nx < W && ny < H;
        if (isNeighborInsideImage) ring[ny * W + nx] = 1;
      }
  }

const ext = new Uint8Array(W * H);
const stack: number[] = [];
for (let column = 0; column < W; column++) {
  stack.push(column);
  stack.push((H - 1) * W + column);
}
for (let y = 0; y < H; y++) {
  stack.push(y * W);
  stack.push(y * W + W - 1);
}
while (stack.length) {
  const p = stack.pop()!;

  const isEdgeOrRingPixel = ext[p] || ring[p];
  if (isEdgeOrRingPixel) continue;

  ext[p] = 1;

  const column = p % W,
    y = (p / W) | 0;

  const hasLeftNeighbor = column > 0;
  if (hasLeftNeighbor) stack.push(p - 1);

  const hasRightNeighbor = column < W - 1;
  if (hasRightNeighbor) stack.push(p + 1);

  const hasUpNeighbor = y > 0;
  if (hasUpNeighbor) stack.push(p - W);

  const hasDownNeighbor = y < H - 1;
  if (hasDownNeighbor) stack.push(p + W);
}
const sil = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  const isExtendedPixel = ext[p] === 1;
  sil[p] = isExtendedPixel ? 0 : 1;
}

const traceContour = () => {
  let start = -1;
  for (let p = 0; p < sil.length && start < 0; p++) {
    const isSilhouettePixel = sil[p] === 1;
    if (isSilhouettePixel) start = p;
  }
  const sx = start % W,
    sy = (start / W) | 0;
  const isSilhouetteAt = (column: number, y: number) =>
    column >= 0 && y >= 0 && column < W && y < H && sil[y * W + column] === 1;
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const pts: [number, number][] = [[sx, sy]];
  let cx = sx,
    cy = sy,
    dir = 6;
  const maxSteps = sil.length * NEIGHBOR_DIRECTION_COUNT;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < NEIGHBOR_DIRECTION_COUNT; k++) {
      const nd = (dir + k) % NEIGHBOR_DIRECTION_COUNT;

      const nx = cx + dirs[nd][0],
        ny = cy + dirs[nd][1];

      const isNeighborOn = isSilhouetteAt(nx, ny);
      if (isNeighborOn) {
        cx = nx;
        cy = ny;
        pts.push([cx, cy]);
        const backtrackDirectionOffset = 5;

        dir = (nd + backtrackDirectionOffset) % NEIGHBOR_DIRECTION_COUNT;
        found = true;
        break;
      }
    }

    const isNoNextStepFound = !found;
    if (isNoNextStepFound) break;

    const minimumClosedPointCount = 2;

    const isBackAtStart = cx === sx && cy === sy && pts.length > minimumClosedPointCount;
    if (isBackAtStart) break;
  }
  return pts;
};

const simplify = (pts: [number, number][], eps: number): [number, number][] => {
  const minimumContourPointCount = 3;

  const isTooFewPoints = pts.length < minimumContourPointCount;
  if (isTooFewPoints) return pts;

  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const segs: [number, number][] = [[0, pts.length - 1]];
  while (segs.length) {
    const [a, b] = segs.pop()!;
    const [ax, ay] = pts[a],
      [bx, by] = pts[b];
    let maxD = -1,
      idx = -1;
    const dx = bx - ax,
      dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];

      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;

      const isFarthestSoFar = d > maxD;
      if (isFarthestSoFar) {
        maxD = d;
        idx = i;
      }
    }

    const isFarEnoughToSplit = maxD > eps && idx > 0;
    if (isFarEnoughToSplit) {
      keep[idx] = 1;
      segs.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
};

const simplifyClosed = (pts: [number, number][], eps: number): [number, number][] => {
  const last = pts[pts.length - 1];

  const isRingAlreadyClosed = pts.length > 1 && pts[0][0] === last[0] && pts[0][1] === last[1];
  const ring = isRingAlreadyClosed ? pts.slice(0, -1) : pts;

  const minimumRingPointCount = 4;

  const isTooSmallRing = ring.length < minimumRingPointCount;
  if (isTooSmallRing) return ring;

  let far = 0,
    fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);

    const isFartherThanCurrentBest = d > fd;
    if (isFartherThanCurrentBest) {
      fd = d;
      far = i;
    }
  }
  const first = simplify(ring.slice(0, far + 1), eps);
  const second = simplify(ring.slice(far).concat([ring[0]]), eps);
  return first.concat(second.slice(1, -1));
};

const simplifyToleranceDistance = 1.5;

const contour = simplifyClosed(traceContour(), simplifyToleranceDistance);
const pathSegments = contour.map(([column, y], i) => {
  const isFirstPoint = i === 0;
  return `${isFirstPoint ? "M" : "L"}${column},${y}`;
});
const d = `${pathSegments.join(" ")} Z`;
fs.mkdirSync(path.dirname(svgPath), { recursive: true });
fs.writeFileSync(svgPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">\n<path d="${d}"/>\n</svg>`);

let area = 0;
for (let p = 0; p < W * H; p++) area += sil[p];
console.log(`silhouette ${area}px | contour points ${contour.length} | wrote ${svgPath}`);
