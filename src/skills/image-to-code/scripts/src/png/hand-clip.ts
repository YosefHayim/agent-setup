#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
/** Build a clip path for the waving hand silhouette from a hand PNG. */
import { PNG } from "pngjs";
import { argString, parseArgs } from "../lib/argv.js";

const args = parseArgs(process.argv.slice(2));
const input = argString(args, "input") || "out/hand.png";
const output = argString(args, "output") || "out/hand-clip.svg";

const { width: W, height: H, data: pixelBytes } = PNG.sync.read(fs.readFileSync(input));

const wall = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  const i = p * 4;
  if (0.299 * pixelBytes[i] + 0.587 * pixelBytes[i + 1] + 0.114 * pixelBytes[i + 2] < 120) wall[p] = 1;
}

const stamp = (mask: Uint8Array, x: number, y: number, r: number) => {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx,
        ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) mask[ny * W + nx] = 1;
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
  for (let s = 0; s <= n; s++)
    stamp(wall, Math.round(ax + ((bx - ax) * s) / n), Math.round(ay + ((by - ay) * s) / n), 3);
}

const ring = new Uint8Array(W * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    if (!wall[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) ring[ny * W + nx] = 1;
      }
  }

const ext = new Uint8Array(W * H);
const stack: number[] = [];
for (let x = 0; x < W; x++) {
  stack.push(x);
  stack.push((H - 1) * W + x);
}
for (let y = 0; y < H; y++) {
  stack.push(y * W);
  stack.push(y * W + W - 1);
}
while (stack.length) {
  const p = stack.pop()!;
  if (ext[p] || ring[p]) continue;
  ext[p] = 1;
  const x = p % W,
    y = (p / W) | 0;
  if (x > 0) stack.push(p - 1);
  if (x < W - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - W);
  if (y < H - 1) stack.push(p + W);
}
const sil = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) sil[p] = ext[p] ? 0 : 1;

const traceContour = () => {
  let start = -1;
  for (let p = 0; p < sil.length && start < 0; p++) if (sil[p]) start = p;
  const sx = start % W,
    sy = (start / W) | 0;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && sil[y * W + x] === 1;
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
  const maxSteps = sil.length * 8;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const nd = (dir + k) % 8;
      const nx = cx + dirs[nd][0],
        ny = cy + dirs[nd][1];
      if (on(nx, ny)) {
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
};

const simplify = (pts: [number, number][], eps: number): [number, number][] => {
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
};

const simplifyClosed = (pts: [number, number][], eps: number): [number, number][] => {
  const last = pts[pts.length - 1];
  const ring = pts.length > 1 && pts[0][0] === last[0] && pts[0][1] === last[1] ? pts.slice(0, -1) : pts;
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
};

const contour = simplifyClosed(traceContour(), 1.5);
const d = `${contour.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ")} Z`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">\n<path d="${d}"/>\n</svg>`);

let area = 0;
for (let p = 0; p < W * H; p++) area += sil[p];
console.log(`silhouette ${area}px | contour points ${contour.length} | wrote ${output}`);
