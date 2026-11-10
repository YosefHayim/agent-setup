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

const src = PNG.sync.read(fs.readFileSync(pngPath));
const { width: W, height: H } = src;

const isLavender = (column: number, y: number) => {
  const bytesPerPixel = 4;

  const i = (y * W + column) * bytesPerPixel;

  const blueChannelOffset = 2;

  const r = src.data[i],
    g = src.data[i + 1],
    b = src.data[i + blueChannelOffset];

  const brightChannelFloor = 205;

  const isNotBrightEnough = Math.min(r, g, b) < brightChannelFloor;
  if (isNotBrightEnough) return false;

  const isNearWhite = r > NEAR_WHITE_CHANNEL_FLOOR && g > NEAR_WHITE_CHANNEL_FLOOR && b > NEAR_WHITE_CHANNEL_FLOOR;
  if (isNearWhite) return false;

  const blueOverRedMargin = 2;

  const blueOverGreenMargin = 4;

  return b > g + blueOverGreenMargin && b >= r - blueOverRedMargin;
};

const F = 3;
const gw = Math.ceil(W / F),
  gh = Math.ceil(H / F);
const grid = new Uint8Array(gw * gh);
for (let gy = 0; gy < gh; gy++) {
  for (let gx = 0; gx < gw; gx++) {
    let hits = 0,
      total = 0;
    for (let dy = 0; dy < F; dy++) {
      for (let dx = 0; dx < F; dx++) {
        const column = gx * F + dx,
          y = gy * F + dy;

        const isOutsideImage = column >= W || y >= H;
        if (isOutsideImage) continue;

        total++;

        if (isLavender(column, y)) hits++;
      }
    }

    const quarterFractionDenominator = 4;

    const isAtLeastQuarterFilled = hits * quarterFractionDenominator >= total;
    if (isAtLeastQuarterFilled) grid[gy * gw + gx] = 1;
  }
}

const comp = new Int32Array(gw * gh).fill(0);
const componentArea: Record<number, number> = {};
let nComp = 0;
const stack: number[] = [];
for (let s = 0; s < gw * gh; s++) {
  const isSkippedCell = !grid[s] || comp[s];
  if (isSkippedCell) continue;

  nComp++;
  comp[s] = nComp;
  stack.length = 0;
  stack.push(s);
  let area = 0;
  while (stack.length) {
    const p = stack.pop()!;
    area++;
    const px = p % gw,
      py = (p / gw) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx,
          ny = py + dy;

        const isOutsideGrid = nx < 0 || ny < 0 || nx >= gw || ny >= gh;
        if (isOutsideGrid) continue;

        const np = ny * gw + nx;

        const isUnvisitedFilledCell = grid[np] && !comp[np];
        if (isUnvisitedFilledCell) {
          comp[np] = nComp;
          stack.push(np);
        }
      }
    }
  }
  componentArea[nComp] = area;
}

const traceContour = (id: number): [number, number][] => {
  let start = -1;
  for (let p = 0; p < grid.length && start < 0; p++) {
    const isPixelInComponent = comp[p] === id;
    if (isPixelInComponent) start = p;
  }
  const sx = start % gw,
    sy = (start / gw) | 0;
  const isInsideComponent = (column: number, y: number) =>
    column >= 0 && y >= 0 && column < gw && y < gh && comp[y * gw + column] === id;
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
  const maxSteps = grid.length * NEIGHBOR_DIRECTION_COUNT;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < NEIGHBOR_DIRECTION_COUNT; k++) {
      const nd = (dir + k) % NEIGHBOR_DIRECTION_COUNT;

      const nx = cx + dirs[nd][0],
        ny = cy + dirs[nd][1];

      const isNeighborInComponent = isInsideComponent(nx, ny);
      if (isNeighborInComponent) {
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

    const minimumBackAtStartPointCount = 2;

    const isBackAtStart = cx === sx && cy === sy && pts.length > minimumBackAtStartPointCount;
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
  const isRingAlreadyClosed =
    pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
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

const MIN_AREA = 60;
const subpaths: string[] = [];
let kept = 0;
for (let id = 1; id <= nComp; id++) {
  const isComponentTooSmall = componentArea[id] < MIN_AREA;
  if (isComponentTooSmall) continue;

  const tracedContour = traceContour(id);

  const simplifyToleranceDistance = 1.4;

  const simp = simplifyClosed(tracedContour, simplifyToleranceDistance);

  const minimumSimplifiedPointCount = 3;

  const isSimplifiedTooSmall = simp.length < minimumSimplifiedPointCount;
  if (isSimplifiedTooSmall) continue;

  kept++;
  const d = simp
    .map(([column, y], i) => {
      const isFirstPoint = i === 0;
      return `${isFirstPoint ? "M" : "L"}${(column * F).toFixed(0)},${(y * F).toFixed(0)}`;
    })
    .join(SPACE_SEPARATOR);
  subpaths.push(`${d} Z`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<path d="${subpaths.join(SPACE_SEPARATOR)}" fill="#f4edfd"/>
</svg>`;
fs.mkdirSync(path.dirname(svgPath), { recursive: true });
fs.writeFileSync(svgPath, svg);
console.log(
  `grid ${gw}x${gh} | components ${nComp} | kept ${kept} | path chars ${subpaths.join(SPACE_SEPARATOR).length}`,
);
