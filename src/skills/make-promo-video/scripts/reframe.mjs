#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const FLAG_PREFIX = "--";

const FFMPEG_MAP_FLAG = "-map";

const STDIO_INHERIT = "inherit";

const FULL_HD_LONG_EDGE_PIXELS = 1920;

const FULL_HD_SHORT_EDGE_PIXELS = 1080;

const SIZES = {
  "16:9": [FULL_HD_LONG_EDGE_PIXELS, FULL_HD_SHORT_EDGE_PIXELS],
  "1:1": [FULL_HD_SHORT_EDGE_PIXELS, FULL_HD_SHORT_EDGE_PIXELS],
  "4:5": [FULL_HD_SHORT_EDGE_PIXELS, 1350],
  "9:16": [FULL_HD_SHORT_EDGE_PIXELS, FULL_HD_LONG_EDGE_PIXELS],
};
const VIDEO_EXPORT_PAD = "[v]";

const createReframeFilter = (width, height) => {
  const blurSigma = 24;
  return (
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=${blurSigma}[bgb];` +
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgs];` +
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1${VIDEO_EXPORT_PAD}`
  );
};

const runFfmpeg = (argumentList) => {
  const ffmpegProcess = spawnSync("ffmpeg", argumentList, { stdio: ["ignore", STDIO_INHERIT, STDIO_INHERIT] });
  const isFfmpegFailed = ffmpegProcess.status !== 0;
  if (isFfmpegFailed) throw new Error(`ffmpeg exited ${ffmpegProcess.status}`);
};

const writeAspectVideo = (masterPath, aspect, exportPath) => {
  const size = SIZES[aspect];
  const isAspectUnknown = size == null;
  if (isAspectUnknown) throw new Error(`Unknown aspect '${aspect}' (use ${Object.keys(SIZES).join(", ")})`);

  const [width, height] = size;
  const reframeFilter = createReframeFilter(width, height);
  runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    masterPath,
    "-filter_complex",
    reframeFilter,
    FFMPEG_MAP_FLAG,
    VIDEO_EXPORT_PAD,
    FFMPEG_MAP_FLAG,
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
    exportPath,
  ]);
  process.stdout.write(`Wrote ${exportPath} (${aspect} ${width}x${height})\n`);
};

const readFlags = (argumentList) => {
  const flags = {};
  for (let index = 0; index < argumentList.length; index++) {
    const argument = argumentList[index];
    const isNotFlag = !argument.startsWith(FLAG_PREFIX);
    if (isNotFlag) continue;

    const flagName = argument.replace(/^--/, "");
    const nextArgument = argumentList[index + 1];
    const isFlagArgumentMissing = !nextArgument || nextArgument.startsWith(FLAG_PREFIX);
    if (isFlagArgumentMissing) {
      flags[flagName] = true;
      continue;
    }

    flags[flagName] = nextArgument;
    index++;
  }
  return flags;
};

const writeAllAspectVideos = (flags) => {
  const exportFolder = flags.outdir || ".";
  mkdirSync(exportFolder, { recursive: true });
  for (const aspect of ["16:9", "1:1", "4:5"]) {
    const variantPath = join(exportFolder, `variant-${aspect.replace(":", "x")}.mp4`);
    writeAspectVideo(flags.in, aspect, variantPath);
  }
};

const runReframeCli = () => {
  const firstArgumentIndex = 2;

  const flags = readFlags(process.argv.slice(firstArgumentIndex));
  const isMasterMissing = !flags.in || !existsSync(flags.in);
  if (isMasterMissing) throw new Error("Pass an existing --in <master.mp4>");

  const isAllRequested = Boolean(flags.all);
  if (isAllRequested) {
    writeAllAspectVideos(flags);
    return;
  }

  const isTargetMissing = !flags.aspect || !flags.out;
  if (isTargetMissing) throw new Error("Pass --aspect <16:9|1:1|4:5> and --out <file>, or --all --outdir <dir>");

  writeAspectVideo(flags.in, flags.aspect, flags.out);
};

const isRunAsScript = import.meta.url === `file://${process.argv[1]}`;
if (isRunAsScript) {
  try {
    runReframeCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
