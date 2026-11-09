#!/usr/bin/env node
import fs from "node:fs";
/** Stitch two PNGs side by side (scaled) for an original-vs-reproduction compare. */
import { PNG } from "pngjs";

const [a, b, out] = process.argv.slice(2);
if (!a || !b || !out) {
  console.error("usage: tsx src/verify/stitch.ts <left.png> <right.png> <out.png>");
  process.exit(2);
}

const S = 460;
const GAP = 24;
const load = (p: string) => PNG.sync.read(fs.readFileSync(p));
const scale = (src: PNG) => {
  const o = new PNG({ width: S, height: S });
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const sx = Math.floor((x * src.width) / S);
      const sy = Math.floor((y * src.height) / S);
      const si = (sy * src.width + sx) * 4;
      const oi = (y * S + x) * 4;
      o.data[oi] = src.data[si];
      o.data[oi + 1] = src.data[si + 1];
      o.data[oi + 2] = src.data[si + 2];
      o.data[oi + 3] = 255;
    }
  return o;
};
const A = scale(load(a));
const B = scale(load(b));
const W = S * 2 + GAP;
const c = new PNG({ width: W, height: S });
c.data.fill(255);
const paste = (img: PNG, ox: number) => {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const si = (y * S + x) * 4;
      const di = (y * W + (x + ox)) * 4;
      c.data[di] = img.data[si];
      c.data[di + 1] = img.data[si + 1];
      c.data[di + 2] = img.data[si + 2];
      c.data[di + 3] = 255;
    }
};
paste(A, 0);
paste(B, S + GAP);
fs.writeFileSync(out, PNG.sync.write(c));
console.log("wrote", out);
