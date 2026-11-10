#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

const TIMECODE_FIELD_DIGITS = 2;

const FFMPEG_MAP_FLAG = "-map";

const FULL_RENDER_MODE = "final";

const FFMPEG_FILE_FLAG = "-i";

const FFMPEG_DURATION_FLAG = "-t";

const FFMPEG_LOOP_FLAG = "-loop";

const ANIMATIC_MODE = "animatic";

const UTF8_ENCODING = "utf8";

const FFMPEG_HIDE_BANNER_FLAG = "-hide_banner";

const STDIO_INHERIT = "inherit";

const FFMPEG_COMMAND = "ffmpeg";

const NEWLINE_CHARACTER = "\n";

const CENTISECONDS_PER_SECOND = 100;
const CENTISECONDS_PER_MINUTE = 6000;
const CENTISECONDS_PER_HOUR = 360000;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60000;
const MILLISECONDS_PER_HOUR = 3600000;
const AUDIO_FORMAT = "aformat=sample_rates=44100:channel_layouts=stereo";
const VIDEO_CONCAT_PAD = "[vcat]";
const VIDEO_EXPORT_PAD = "[vout]";
const AUDIO_MIX_PAD = "[amix]";
const AUDIO_EXPORT_PAD = "[aout]";
const NO_OP_VIDEO_FILTER = `${VIDEO_CONCAT_PAD}null${VIDEO_EXPORT_PAD}`;
const isRunAsScript = import.meta.url === `file://${process.argv[1]}`;

const padWithZeros = (number, digitCount) => String(number).padStart(digitCount, "0");

const sumDurationSeconds = (scenes) => scenes.reduce((totalSeconds, scene) => totalSeconds + scene.durationSec, 0);

const listSceneTimings = (scenes) =>
  scenes.map((scene, index) => {
    const startSeconds = sumDurationSeconds(scenes.slice(0, index));
    return { scene, number: index + 1, startSeconds, endSeconds: startSeconds + scene.durationSec };
  });

const createStillSegment = ({ inputIndex, width, height, fps, durationSec, label }) => {
  const frameCount = Math.max(1, Math.round(durationSec * fps));
  const overscanFactor = 1.3;
  const overscanWidth = Math.round(width * overscanFactor);
  const overscanHeight = Math.round(height * overscanFactor);
  return (
    `[${inputIndex}:v]scale=${overscanWidth}:${overscanHeight}:force_original_aspect_ratio=increase,crop=${overscanWidth}:${overscanHeight},` +
    `zoompan=z='min(zoom+0.0012,1.25)':d=${frameCount}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps=${fps}:s=${width}x${height},` +
    `setsar=1[${label}]`
  );
};

const createClipSegment = ({ inputIndex, width, height, fps, durationSec, label }) => {
  return (
    `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},` +
    `trim=0:${durationSec},setpts=PTS-STARTPTS,setsar=1[${label}]`
  );
};

// No zoompan here: many ffmpeg builds mis-render it on the first segment.
const createAnimaticSegment = ({ inputIndex, width, height, fps, label }) => {
  const backgroundBlurRadius = 20;
  const backgroundBrightness = -0.32;
  return (
    `[${inputIndex}:v]split=2[abg${inputIndex}][afg${inputIndex}];` +
    `[abg${inputIndex}]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=${backgroundBlurRadius}:1,eq=brightness=${backgroundBrightness}[bg${inputIndex}];` +
    `[afg${inputIndex}]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg${inputIndex}];` +
    `[bg${inputIndex}][fg${inputIndex}]overlay=(W-w)/2:(H-h)/2,fps=${fps},setsar=1[${label}]`
  );
};

const createAssTimestamp = (seconds) => {
  const centiseconds = Math.max(0, Math.round(seconds * CENTISECONDS_PER_SECOND));
  const hours = Math.floor(centiseconds / CENTISECONDS_PER_HOUR);
  const minutes = Math.floor((centiseconds % CENTISECONDS_PER_HOUR) / CENTISECONDS_PER_MINUTE);
  const wholeSeconds = Math.floor((centiseconds % CENTISECONDS_PER_MINUTE) / CENTISECONDS_PER_SECOND);
  const hundredths = centiseconds % CENTISECONDS_PER_SECOND;
  return `${hours}:${padWithZeros(minutes, TIMECODE_FIELD_DIGITS)}:${padWithZeros(wholeSeconds, TIMECODE_FIELD_DIGITS)}.${padWithZeros(hundredths, TIMECODE_FIELD_DIGITS)}`;
};

const createSrtTimestamp = (seconds) => {
  const milliseconds = Math.max(0, Math.round(seconds * MILLISECONDS_PER_SECOND));
  const hours = Math.floor(milliseconds / MILLISECONDS_PER_HOUR);
  const minutes = Math.floor((milliseconds % MILLISECONDS_PER_HOUR) / MILLISECONDS_PER_MINUTE);
  const wholeSeconds = Math.floor((milliseconds % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND);
  const remainderMilliseconds = milliseconds % MILLISECONDS_PER_SECOND;
  const millisecondDigits = 3;

  return `${padWithZeros(hours, TIMECODE_FIELD_DIGITS)}:${padWithZeros(minutes, TIMECODE_FIELD_DIGITS)}:${padWithZeros(wholeSeconds, TIMECODE_FIELD_DIGITS)},${padWithZeros(remainderMilliseconds, millisecondDigits)}`;
};

// ASS subtitle file with styling baked in, so ffmpeg needs no comma-laden force_style.
const createAssSubtitles = ({ scenes, width, height }) => {
  const headerLines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,0,2,80,80,150,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const dialogueLines = listSceneTimings(scenes)
    .filter(({ scene }) => Boolean(scene.caption))
    .map(({ scene, startSeconds, endSeconds }) => {
      // e.g. "line1\nline2" becomes "line1\\Nline2"; strip ASS override braces
      const assCaption = String(scene.caption).replace(/\r?\n/g, "\\N").replace(/[{}]/g, "");
      const startStamp = createAssTimestamp(startSeconds);
      const endStamp = createAssTimestamp(endSeconds);
      return `Dialogue: 0,${startStamp},${endStamp},Default,,0,0,0,,${assCaption}`;
    });
  return `${[...headerLines, ...dialogueLines].join(NEWLINE_CHARACTER)}\n`;
};

// SRT sidecar with cumulative timings: a caption track every platform accepts on upload.
const createSrtSubtitles = (scenes) => {
  const captionBlocks = listSceneTimings(scenes)
    .filter(({ scene }) => Boolean(scene.caption))
    .map(({ scene, number, startSeconds, endSeconds }) => {
      const startStamp = createSrtTimestamp(startSeconds);
      const endStamp = createSrtTimestamp(endSeconds);
      return `${number}\n${startStamp} --> ${endStamp}\n${scene.caption}\n`;
    });
  return captionBlocks.join(NEWLINE_CHARACTER);
};

// e.g. "C:\path:file" becomes "C\\:path\\:file" for ffmpeg filter args
const escapeSubtitlePath = (filePath) => filePath.replace(/[\\:',;[\]]/g, (character) => `\\${character}`);

const runFfmpeg = (argumentList, workingDirectory) => {
  const ffmpegProcess = spawnSync(FFMPEG_COMMAND, argumentList, { stdio: ["ignore", STDIO_INHERIT, STDIO_INHERIT], cwd: workingDirectory });
  const isFfmpegFailed = ffmpegProcess.status !== 0;
  if (isFfmpegFailed) throw new Error(`ffmpeg exited ${ffmpegProcess.status}`);
};

// True when this ffmpeg was built with libass, so it can burn captions.
const hasSubtitlesFilter = () => {
  const filterListProcess = spawnSync(FFMPEG_COMMAND, [FFMPEG_HIDE_BANNER_FLAG, "-filters"], { encoding: UTF8_ENCODING });
  const isFilterListMissing = typeof filterListProcess.stdout !== "string";
  if (isFilterListMissing) return false;

  return /\bsubtitles\b/.test(filterListProcess.stdout);
};

// e.g. "--mode" becomes the key "mode"
const readFlags = (argumentList) => {
  const flagPairs = [];
  const argumentPairStride = TIMECODE_FIELD_DIGITS;

  for (let index = 0; index < argumentList.length; index += argumentPairStride) {
    const flagName = argumentList[index].replace(/^--/, "");
    flagPairs.push([flagName, argumentList[index + 1]]);
  }
  return Object.fromEntries(flagPairs);
};

const createScenePath = (relativePath, baseDirectory) => {
  const isAbsolutePath = isAbsolute(relativePath);
  return isAbsolutePath ? relativePath : resolve(baseDirectory, relativePath);
};

const readSceneMedia = (scene, baseDirectory) => {
  const relativePath = scene.clipPath ?? scene.stillPath ?? scene.screenshot;
  const isPathMissing = !relativePath;
  if (isPathMissing) throw new Error(`Scene ${scene.id} has no clip, still, or screenshot`);

  const mediaPath = createScenePath(relativePath, baseDirectory);
  const isFileMissing = !existsSync(mediaPath);
  if (isFileMissing) throw new Error(`Scene ${scene.id}: missing file ${mediaPath}`);

  return { mediaPath, isClip: Boolean(scene.clipPath) };
};

// Absolute path to a scene's STILL (never its clip): the animatic is the pre-motion gate.
const readStillPath = (scene, baseDirectory) => {
  const relativePath = scene.stillPath ?? scene.screenshot;
  const isPathMissing = !relativePath;
  if (isPathMissing) throw new Error(`Scene ${scene.id} has no still or screenshot for the animatic`);

  const stillPath = createScenePath(relativePath, baseDirectory);
  const isFileMissing = !existsSync(stillPath);
  if (isFileMissing) throw new Error(`Scene ${scene.id}: missing still ${stillPath}`);

  return stillPath;
};

const createSceneStream = ({ scene, sceneIndex, segmentLabel, baseDirectory, mode, width, height, fps, durationSec }) => {
  const isAnimaticMode = mode === ANIMATIC_MODE;
  if (isAnimaticMode) {
    // Pre-motion gate: hold each still for its beat, blurred-fill so wide action survives, ignore any clip.
    const stillPath = readStillPath(scene, baseDirectory);
    return {
      streamFileFlags: [FFMPEG_LOOP_FLAG, "1", FFMPEG_DURATION_FLAG, String(durationSec), FFMPEG_FILE_FLAG, stillPath],
      segmentFilter: createAnimaticSegment({ inputIndex: sceneIndex, width, height, fps, label: segmentLabel }),
    };
  }

  const { mediaPath, isClip } = readSceneMedia(scene, baseDirectory);
  if (isClip) {
    return {
      streamFileFlags: [FFMPEG_FILE_FLAG, mediaPath],
      segmentFilter: createClipSegment({ inputIndex: sceneIndex, width, height, fps, durationSec, label: segmentLabel }),
    };
  }

  return {
    streamFileFlags: [FFMPEG_LOOP_FLAG, "1", FFMPEG_DURATION_FLAG, String(durationSec), FFMPEG_FILE_FLAG, mediaPath],
    segmentFilter: createStillSegment({ inputIndex: sceneIndex, width, height, fps, durationSec, label: segmentLabel }),
  };
};

const createSceneStreams = ({ scenes, baseDirectory, mode, width, height, fps, hold }) => {
  const streamFileFlags = [];
  const segmentFilters = [];
  const segmentLabels = [];
  for (const [sceneIndex, scene] of scenes.entries()) {
    const segmentLabel = `v${sceneIndex}`;
    const durationSec = hold ?? scene.durationSec;
    const scenePlan = createSceneStream({ scene, sceneIndex, segmentLabel, baseDirectory, mode, width, height, fps, durationSec });
    streamFileFlags.push(...scenePlan.streamFileFlags);
    segmentFilters.push(scenePlan.segmentFilter);
    segmentLabels.push(`[${segmentLabel}]`);
  }
  return { streamFileFlags, segmentFilters, segmentLabels };
};

const createVoiceAndMusicAudio = ({ voicePath, musicPath, firstInputIndex, totalSeconds }) => {
  const musicStreamIndex = firstInputIndex;
  const voiceStreamIndex = firstInputIndex + 1;
  return {
    streamFileFlags: [FFMPEG_FILE_FLAG, musicPath, FFMPEG_FILE_FLAG, voicePath],
    filters: [
      `[${musicStreamIndex}:a]${AUDIO_FORMAT},atrim=0:${totalSeconds},apad=whole_dur=${totalSeconds},volume=0.55[mus]`,
      `[${voiceStreamIndex}:a]${AUDIO_FORMAT},asplit=2[voa][vob]`,
      "[mus][voa]sidechaincompress=threshold=0.02:ratio=6:attack=5:release=250[musd]",
      `[musd][vob]amix=inputs=2:duration=first:normalize=0${AUDIO_MIX_PAD}`,
    ],
  };
};

const createMusicOnlyAudio = ({ musicPath, firstInputIndex, totalSeconds }) => {
  return {
    streamFileFlags: [FFMPEG_FILE_FLAG, musicPath],
    filters: [`[${firstInputIndex}:a]${AUDIO_FORMAT},atrim=0:${totalSeconds},apad=whole_dur=${totalSeconds}${AUDIO_MIX_PAD}`],
  };
};

const createVoiceOnlyAudio = ({ voicePath, firstInputIndex, totalSeconds }) => {
  return {
    streamFileFlags: [FFMPEG_FILE_FLAG, voicePath],
    filters: [`[${firstInputIndex}:a]${AUDIO_FORMAT},apad=whole_dur=${totalSeconds},atrim=0:${totalSeconds}${AUDIO_MIX_PAD}`],
  };
};

const createSilentAudio = ({ firstInputIndex, totalSeconds }) => {
  return {
    streamFileFlags: ["-f", "lavfi", FFMPEG_FILE_FLAG, "anullsrc=r=44100:cl=stereo"],
    filters: [`[${firstInputIndex}:a]atrim=0:${totalSeconds}${AUDIO_MIX_PAD}`],
  };
};

const createAudioMix = ({ voicePath, musicPath, firstInputIndex, totalSeconds }) => {
  const hasVoiceOver = voicePath != null;
  const hasMusic = musicPath != null;

  const isVoiceAndMusic = hasVoiceOver && hasMusic;
  if (isVoiceAndMusic) return createVoiceAndMusicAudio({ voicePath, musicPath, firstInputIndex, totalSeconds });

  if (hasMusic) return createMusicOnlyAudio({ musicPath, firstInputIndex, totalSeconds });

  if (hasVoiceOver) return createVoiceOnlyAudio({ voicePath, firstInputIndex, totalSeconds });

  return createSilentAudio({ firstInputIndex, totalSeconds });
};

const createAudioPlan = ({ manifest, baseDirectory, mode, totalSeconds, firstInputIndex }) => {
  const isVoiceOverAllowed = mode !== ANIMATIC_MODE && Boolean(manifest.audio?.voPath);
  const voicePath = isVoiceOverAllowed ? resolve(baseDirectory, manifest.audio.voPath) : null;
  const isMusicProvided = Boolean(manifest.audio?.musicPath);
  const musicPath = isMusicProvided ? resolve(baseDirectory, manifest.audio.musicPath) : null;
  const audioMix = createAudioMix({ voicePath, musicPath, firstInputIndex, totalSeconds });

  const isFullRenderMode = mode === FULL_RENDER_MODE;
  const finishFilter = isFullRenderMode
    ? `${AUDIO_MIX_PAD}loudnorm=I=-14:TP=-1:LRA=11${AUDIO_EXPORT_PAD}`
    : `${AUDIO_MIX_PAD}anull${AUDIO_EXPORT_PAD}`;
  return { streamFileFlags: audioMix.streamFileFlags, filters: [...audioMix.filters, finishFilter] };
};

const createCaptionStep = ({ mode, canBurn, scenes, width, height, outputPath }) => {
  const absoluteExportPath = resolve(outputPath);
  const isBurningCaptions = mode === FULL_RENDER_MODE && canBurn;
  if (isBurningCaptions) {
    // ffmpeg runs with cwd = the output dir, so reference the sidecar by bare
    // name: an absolute path trips the subtitles filter's option lexer.
    const assPath = `${absoluteExportPath}.ass`;
    const assFileName = escapeSubtitlePath(basename(assPath));
    return {
      filter: `${VIDEO_CONCAT_PAD}subtitles=${assFileName}${VIDEO_EXPORT_PAD}`,
      captionFile: { path: assPath, text: createAssSubtitles({ scenes, width, height }) },
    };
  }

  const isSrtSidecarNeeded = mode === FULL_RENDER_MODE;
  if (isSrtSidecarNeeded) {
    return {
      filter: NO_OP_VIDEO_FILTER,
      captionFile: { path: `${absoluteExportPath}.srt`, text: createSrtSubtitles(scenes) },
    };
  }

  return { filter: NO_OP_VIDEO_FILTER, captionFile: null };
};

const createCut = ({ manifest, baseDirectory, mode, outputPath, canBurn, hold }) => {
  const { width, height, fps } = manifest.format;
  const scenes = [...manifest.scenes].sort((first, second) => first.order - second.order);
  const isSceneListEmpty = scenes.length === 0;
  if (isSceneListEmpty) throw new Error("Manifest has no scenes");

  const sceneStreams = createSceneStreams({ scenes, baseDirectory, mode, width, height, fps, hold });
  const totalSeconds = scenes.reduce((totalSoFar, scene) => totalSoFar + (hold ?? scene.durationSec), 0);
  const concatFilter = `${sceneStreams.segmentLabels.join("")}concat=n=${scenes.length}:v=1:a=0${VIDEO_CONCAT_PAD}`;
  const captionStep = createCaptionStep({ mode, canBurn, scenes, width, height, outputPath });
  const audioPlan = createAudioPlan({ manifest, baseDirectory, mode, totalSeconds, firstInputIndex: scenes.length });
  const filters = [...sceneStreams.segmentFilters, concatFilter, captionStep.filter, ...audioPlan.filters];

  const isFullRenderMode = mode === FULL_RENDER_MODE;
  const preset = isFullRenderMode ? "medium" : "ultrafast";
  const constantRateFactor = isFullRenderMode ? "18" : "28";
  const argumentList = [
    FFMPEG_HIDE_BANNER_FLAG,
    "-loglevel",
    "error",
    "-y",
    ...sceneStreams.streamFileFlags,
    ...audioPlan.streamFileFlags,
    "-filter_complex",
    filters.join(";"),
    FFMPEG_MAP_FLAG,
    VIDEO_EXPORT_PAD,
    FFMPEG_MAP_FLAG,
    AUDIO_EXPORT_PAD,
    "-c:v", "libx264", "-preset", preset, "-crf", constantRateFactor, "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k",
    FFMPEG_DURATION_FLAG, String(totalSeconds),
    "-movflags", "+faststart",
    resolve(outputPath),
  ];
  return { argumentList, captionFile: captionStep.captionFile };
};

const runAssembleCommand = () => {
  const firstArgumentIndex = TIMECODE_FIELD_DIGITS;

  const flags = readFlags(process.argv.slice(firstArgumentIndex));
  const isUsageMissing = !flags.manifest || !flags.out;
  if (isUsageMissing)
    throw new Error("Usage: assemble-cut.mjs --manifest <manifest.json> --mode rough|final|animatic [--hold <sec>] --out <file>");

  const isFullRenderMode = flags.mode === FULL_RENDER_MODE;
  const isAnimaticMode = flags.mode === ANIMATIC_MODE;
  const isKnownMode = isFullRenderMode || isAnimaticMode;
  const mode = isKnownMode ? flags.mode : "rough";
  const manifest = JSON.parse(readFileSync(flags.manifest, UTF8_ENCODING));
  const baseDirectory = dirname(resolve(flags.manifest));
  const exportFolder = dirname(resolve(flags.out));
  mkdirSync(exportFolder, { recursive: true });

  const canBurn = isFullRenderMode && hasSubtitlesFilter();
  const isHoldRequested = isAnimaticMode && Boolean(flags.hold);
  const hold = isHoldRequested ? Number(flags.hold) : null;
  const cutPlan = createCut({ manifest, baseDirectory, mode, outputPath: flags.out, canBurn, hold });

  const isCaptionFileNeeded = cutPlan.captionFile != null;
  if (isCaptionFileNeeded) writeFileSync(cutPlan.captionFile.path, cutPlan.captionFile.text);

  const isSrtSidecarUsed = isFullRenderMode && !canBurn;
  if (isSrtSidecarUsed)
    process.stderr.write(
      "warning: this ffmpeg has no 'subtitles' filter (no libass) — captions were NOT burned in. " +
        "Wrote a .srt sidecar to upload as a caption track, or install an ffmpeg built with libass.\n",
    );

  runFfmpeg(cutPlan.argumentList, exportFolder);
  const sidecarNote = isSrtSidecarUsed ? ", captions as .srt sidecar" : "";
  process.stdout.write(`Wrote ${flags.out} (${mode}${sidecarNote})\n`);
};

if (isRunAsScript) {
  try {
    runAssembleCommand();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
