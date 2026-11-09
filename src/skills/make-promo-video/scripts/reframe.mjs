#!/usr/bin/env node
/**
 * Derive platform cuts from the 9:16 master with a blurred-fill reframe (the
 * scaled video centered over a blurred, cover-cropped copy of itself) — so a
 * vertical master becomes a clean 16:9 / 1:1 / 4:5 without hard letterbox bars.
 *
 * Usage:
 *   node reframe.mjs --in master-9x16.mp4 --aspect 16:9 --out out.mp4
 *   node reframe.mjs --in master-9x16.mp4 --all --outdir build   # 16:9 + 1:1 + 4:5
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Output pixel sizes per target aspect (1080-based, even dimensions for h264). */
const SIZES = {
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "9:16": [1080, 1920],
};

/** filter_complex for a blurred-fill reframe to WxH. */
export function reframeFilter(w, h) {
  return (
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=24[bgb];` +
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs];` +
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`
  );
}

// --- IO layer ---

function run(args) {
  const res = spawnSync("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
  if (res.status !== 0) throw new Error(`ffmpeg exited ${res.status}`);
}

function reframeTo(input, aspect, out) {
  const size = SIZES[aspect];
  if (!size) throw new Error(`Unknown aspect '${aspect}' (use ${Object.keys(SIZES).join(", ")})`);
  const [w, h] = size;
  run([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-filter_complex",
    reframeFilter(w, h),
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    out,
  ]);
  process.stdout.write(`Wrote ${out} (${aspect} ${w}x${h})\n`);
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    // e.g. "--ratio" → "ratio"
    const key = a.replace(/^--/, "");
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  if (!f.in || !existsSync(f.in)) throw new Error("Pass an existing --in <master.mp4>");
  if (f.all) {
    const outdir = f.outdir || ".";
    mkdirSync(outdir, { recursive: true });
    for (const aspect of ["16:9", "1:1", "4:5"]) {
      reframeTo(f.in, aspect, join(outdir, `variant-${aspect.replace(":", "x")}.mp4`));
    }
    return;
  }
  if (!f.aspect || !f.out) throw new Error("Pass --aspect <16:9|1:1|4:5> and --out <file>, or --all --outdir <dir>");
  reframeTo(f.in, f.aspect, f.out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
