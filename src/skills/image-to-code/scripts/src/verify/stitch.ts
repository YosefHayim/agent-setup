#!/usr/bin/env node
import fs from "node:fs";
import { PNG } from "pngjs";

const ALPHA_CHANNEL_OFFSET = 3;

const MAX_CHANNEL_LEVEL = 255;

const BYTES_PER_PIXEL = 4;

const firstArgumentIndex = 2;

const [a, b, out] = process.argv.slice(firstArgumentIndex);

const isStitchPathMissing = !a || !b || !out;
if (isStitchPathMissing) {
  console.error("usage: tsx src/verify/stitch.ts <left.png> <right.png> <out.png>");
  const usageExitCode = 2;

  process.exit(usageExitCode);
}

const S = 460;
const GAP = 24;
const load = (p: string) => PNG.sync.read(fs.readFileSync(p));
const scale = (src: PNG) => {
  const o = new PNG({ width: S, height: S });
  for (let y = 0; y < S; y++)
    for (let column = 0; column < S; column++) {
      const sx = Math.floor((column * src.width) / S);
      const sy = Math.floor((y * src.height) / S);
      const si = (sy * src.width + sx) * BYTES_PER_PIXEL;
      const oi = (y * S + column) * BYTES_PER_PIXEL;
      o.data[oi] = src.data[si];
      o.data[oi + 1] = src.data[si + 1];
      const blueChannelOffset = 2;

      const blueByteOffsetInPixel = 2;

      o.data[oi + blueChannelOffset] = src.data[si + blueByteOffsetInPixel];
      o.data[oi + ALPHA_CHANNEL_OFFSET] = MAX_CHANNEL_LEVEL;
    }
  return o;
};
const A = scale(load(a));
const B = scale(load(b));
const W = S * 2 + GAP;
const c = new PNG({ width: W, height: S });
c.data.fill(MAX_CHANNEL_LEVEL);
const paste = (img: PNG, ox: number) => {
  for (let y = 0; y < S; y++)
    for (let column = 0; column < S; column++) {
      const si = (y * S + column) * BYTES_PER_PIXEL;
      const di = (y * W + (column + ox)) * BYTES_PER_PIXEL;
      c.data[di] = img.data[si];
      c.data[di + 1] = img.data[si + 1];
      const blueChannelOffsetInStitched = 2;

      const imageBlueChannelOffset = 2;

      c.data[di + blueChannelOffsetInStitched] = img.data[si + imageBlueChannelOffset];
      c.data[di + ALPHA_CHANNEL_OFFSET] = MAX_CHANNEL_LEVEL;
    }
};
paste(A, 0);
paste(B, S + GAP);
fs.writeFileSync(out, PNG.sync.write(c));
console.log("wrote", out);
