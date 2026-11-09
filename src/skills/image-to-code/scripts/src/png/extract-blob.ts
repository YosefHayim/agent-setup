#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
/** Extract soft lavender background blob from a PNG as an SVG path. */
import { PNG } from "pngjs";
import { argString, parseArgs } from "../lib/argv.js";

const args = parseArgs(process.argv.slice(2));
const input = argString(args, "input") || "design.png";
const output = argString(args, "output") || "out/blob.svg";

const src = PNG.sync.read(fs.readFileSync(input));
const { width: W, height: H } = src;

const isLavender = (x: number, y: number) => {
  const i = (y * W + x) * 4;
  const r = src.data[i],
    g = src.data[i + 1],
    b = src.data[i + 2];
  if (Math.min(r, g, b) < 205) return false;
  if (r > 250 && g > 250 && b > 250) return false;
  return b > g + 4 && b >= r - 2;
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
        const x = gx * F + dx,
          y = gy * F + dy;
        if (x >= W || y >= H) continue;
        total++;
        if (isLavender(x, y)) hits++;
      }
    }
    if (hits * 4 >= total) grid[gy * gw + gx] = 1;
  }
}

const comp = new Int32Array(gw * gh).fill(0);
const componentArea: Record<number, number> = {};
let nComp = 0;
const stack: number[] = [];
for (let s = 0; s < gw * gh; s++) {
  if (!grid[s] || comp[s]) continue;
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
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const np = ny * gw + nx;
        if (grid[np] && !comp[np]) {
          comp[np] = nComp;
          stack.push(np);
        }
      }
    }
  }
  componentArea[nComp] = area;
}

function traceContour(id: number): [number, number][] {
  let start = -1;
  for (let p = 0; p < grid.length && start < 0; p++) if (comp[p] === id) start = p;
  const sx = start % gw,
    sy = (start / gw) | 0;
  const inComp = (x: number, y: number) => x >= 0 && y >= 0 && x < gw && y < gh && comp[y * gw + x] === id;
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
  const maxSteps = grid.length * 8;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (dir + k) % 8;
      const nx = cx + dirs[nd][0],
        ny = cy + dirs[nd][1];
      if (inComp(nx, ny)) {
        cx = nx;
        cy = ny;
        pts.push([cx, cy]);
        dir = (nd + 5) % 8;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cy === sy && pts.length > 2) break;
  }
  return pts;
}

function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
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
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      segs.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function simplifyClosed(pts: [number, number][], eps: number): [number, number][] {
  const ring =
    pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
      ? pts.slice(0, -1)
      : pts;
  if (ring.length < 4) return ring;
  let far = 0,
    fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const first = simplify(ring.slice(0, far + 1), eps);
  const second = simplify(ring.slice(far).concat([ring[0]]), eps);
  return first.concat(second.slice(1, -1));
}

const MIN_AREA = 60;
const subpaths: string[] = [];
let kept = 0;
for (let id = 1; id <= nComp; id++) {
  if (componentArea[id] < MIN_AREA) continue;
  const tracedContour = traceContour(id);
  const simp = simplifyClosed(tracedContour, 1.4);
  if (simp.length < 3) continue;
  kept++;
  const d = simp.map(([x, y], i) => `${i === 0 ? "M" : "L"}${(x * F).toFixed(0)},${(y * F).toFixed(0)}`).join(" ");
  subpaths.push(`${d} Z`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<path d="${subpaths.join(" ")}" fill="#f4edfd"/>
</svg>`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, svg);
console.log(`grid ${gw}x${gh} | components ${nComp} | kept ${kept} | path chars ${subpaths.join(" ").length}`);
