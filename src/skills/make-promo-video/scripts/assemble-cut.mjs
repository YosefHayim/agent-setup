#!/usr/bin/env node
/**
 * Assemble the trailer from the manifest with ffmpeg.
 *
 * Each scene becomes a segment — its `clipPath` when present, else a Ken-Burns
 * push on `stillPath`/`screenshot` — sized to the manifest format, concatenated
 * in `order`. Audio mixes the voiceover over a sidechain-ducked music bed.
 *   --mode rough    : fast preview, no captions, no loudnorm.
 *   --mode final    : burned captions + loudnorm to -14 LUFS / -1 dBTP.
 *   --mode animatic : the pre-motion GATE — every scene is its STILL held for its
 *                     beat (blurred-fill, so nothing wide is cropped; no zoompan, which
 *                     some ffmpeg builds choke on) over a scratch music bed; no motion,
 *                     no captions. Watch the whole story and approve order/pacing BEFORE
 *                     spending any motion credit. `--hold <sec>` forces a uniform beat.
 *
 * Assumes referenced media exists and motion clips are >= their scene duration;
 * it fails loudly on a missing file rather than shipping a gap.
 *
 * Usage: node assemble-cut.mjs --manifest <dir>/manifest.json --mode rough|final|animatic [--hold <sec>] --out <file>
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

// --- pure: filter construction ---

/** Ken-Burns segment for a still input at ffmpeg index `idx`. */
export function stillSegment(idx, w, h, fps, dur, label) {
  const frames = Math.max(1, Math.round(dur * fps));
  const sw = Math.round(w * 1.3);
  const sh = Math.round(h * 1.3);
  return (
    `[${idx}:v]scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},` +
    `zoompan=z='min(zoom+0.0012,1.25)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps=${fps}:s=${w}x${h},` +
    `setsar=1[${label}]`
  );
}

/** Trim/cover segment for a motion-clip input at ffmpeg index `idx`. */
export function clipSegment(idx, w, h, fps, dur, label) {
  return (
    `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},` +
    `trim=0:${dur},setpts=PTS-STARTPTS,setsar=1[${label}]`
  );
}

/**
 * Held-still segment for the animatic at ffmpeg index `idx`. No zoompan (many ffmpeg
 * builds mis-render it on the first segment) and no crop — a blurred, darkened copy of
 * the frame fills the 9:16 canvas while the whole 16:9 frame sits sharp and centred, so
 * no wide action is sliced off. The still input is looped to its beat before this filter.
 */
export function animaticSegment(idx, w, h, fps, label) {
  return (
    `[${idx}:v]split=2[abg${idx}][afg${idx}];` +
    `[abg${idx}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:1,eq=brightness=-0.32[bg${idx}];` +
    `[afg${idx}]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg${idx}];` +
    `[bg${idx}][fg${idx}]overlay=(W-w)/2:(H-h)/2,fps=${fps},setsar=1[${label}]`
  );
}

/** ASS timestamp `H:MM:SS.cc` from seconds. */
function assTime(s) {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** ASS subtitle file with styling baked in, so ffmpeg needs no comma-laden force_style. */
export function toAss(scenes, w, h) {
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,0,2,80,80,150,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  let t = 0;
  for (const s of scenes) {
    const end = t + s.durationSec;
    if (s.caption) {
      // e.g. "line1\nline2" → "line1\\Nline2"; strip ASS override braces
      const text = String(s.caption).replace(/\r?\n/g, "\\N").replace(/[{}]/g, "");
      lines.push(`Dialogue: 0,${assTime(t)},${assTime(end)},Default,,0,0,0,,${text}`);
    }
    t = end;
  }
  return `${lines.join("\n")}\n`;
}

/** SRT sidecar (cumulative timings) — a caption track every platform accepts on upload. */
export function toSrt(scenes) {
  const stamp = (s) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const hh = String(Math.floor(ms / 3600000)).padStart(2, "0");
    const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    return `${hh}:${mm}:${ss},${String(ms % 1000).padStart(3, "0")}`;
  };
  let t = 0;
  const blocks = [];
  scenes.forEach((s, i) => {
    const end = t + s.durationSec;
    if (s.caption) blocks.push(`${i + 1}\n${stamp(t)} --> ${stamp(end)}\n${s.caption}\n`);
    t = end;
  });
  return blocks.join("\n");
}

// e.g. "C:\path:file" → "C\\:path\\:file" for ffmpeg filter args
const escapeSub = (p) => p.replace(/[\\:',;[\]]/g, (c) => `\\${c}`);

// --- IO layer ---

function run(args, cwd) {
  const res = spawnSync("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"], cwd });
  if (res.status !== 0) throw new Error(`ffmpeg exited ${res.status}`);
}

/** True when this ffmpeg was built with libass (so it can burn captions). */
function hasSubtitlesFilter() {
  const res = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
  // e.g. ffmpeg filter list contains the word "subtitles"
  return typeof res.stdout === "string" && /\bsubtitles\b/.test(res.stdout);
}

function parseFlags(argv) {
  const out = {};
  // e.g. "--mode" → "mode"
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

function sceneMedia(scene, baseDir) {
  const rel = scene.clipPath ?? scene.stillPath ?? scene.screenshot;
  if (!rel) throw new Error(`Scene ${scene.id} has no clip, still, or screenshot`);
  const abs = isAbsolute(rel) ? rel : resolve(baseDir, rel);
  if (!existsSync(abs)) throw new Error(`Scene ${scene.id}: missing file ${abs}`);
  return { abs, isClip: Boolean(scene.clipPath) };
}

/** Absolute path to a scene's STILL (never its clip) — the animatic is the pre-motion gate. */
function stillMedia(scene, baseDir) {
  const rel = scene.stillPath ?? scene.screenshot;
  if (!rel) throw new Error(`Scene ${scene.id} has no still or screenshot for the animatic`);
  const abs = isAbsolute(rel) ? rel : resolve(baseDir, rel);
  if (!existsSync(abs)) throw new Error(`Scene ${scene.id}: missing still ${abs}`);
  return abs;
}

function build(manifest, baseDir, mode, out, canBurn, hold) {
  const { width: w, height: h, fps } = manifest.format;
  const scenes = [...manifest.scenes].sort((a, b) => a.order - b.order);
  if (scenes.length === 0) throw new Error("Manifest has no scenes");

  const inputArgs = [];
  const segFilters = [];
  const labels = [];
  scenes.forEach((scene, i) => {
    const label = `v${i}`;
    const dur = hold ?? scene.durationSec;
    if (mode === "animatic") {
      // Pre-motion gate: hold each still for its beat, blurred-fill so wide action survives, ignore any clip.
      inputArgs.push("-loop", "1", "-t", String(dur), "-i", stillMedia(scene, baseDir));
      segFilters.push(animaticSegment(i, w, h, fps, label));
    } else {
      const { abs, isClip } = sceneMedia(scene, baseDir);
      if (isClip) {
        inputArgs.push("-i", abs);
        segFilters.push(clipSegment(i, w, h, fps, dur, label));
      } else {
        inputArgs.push("-loop", "1", "-t", String(dur), "-i", abs);
        segFilters.push(stillSegment(i, w, h, fps, dur, label));
      }
    }
    labels.push(`[${label}]`);
  });

  const total = scenes.reduce((sum, s) => sum + (hold ?? s.durationSec), 0);
  const videoOut = "vout";
  const filters = [...segFilters, `${labels.join("")}concat=n=${scenes.length}:v=1:a=0[vcat]`];

  if (mode === "final" && canBurn) {
    // ffmpeg runs with cwd = the output dir, so reference the sidecar by bare
    // name — an absolute path trips the subtitles filter's option lexer.
    const assAbs = `${resolve(out)}.ass`;
    writeFileSync(assAbs, toAss(scenes, w, h));
    filters.push(`[vcat]subtitles=${escapeSub(basename(assAbs))}[vout]`);
  } else {
    if (mode === "final") {
      writeFileSync(`${resolve(out)}.srt`, toSrt(scenes));
      process.stderr.write(
        "warning: this ffmpeg has no 'subtitles' filter (no libass) — captions were NOT burned in. " +
          "Wrote a .srt sidecar to upload as a caption track, or install an ffmpeg built with libass.\n",
      );
    }
    filters.push("[vcat]null[vout]");
  }

  // Audio: index offset starts after all scene inputs.
  let idx = scenes.length;
  // The animatic judges pacing against a scratch music bed only — no VO yet.
  const vo = mode !== "animatic" && manifest.audio?.voPath ? resolve(baseDir, manifest.audio.voPath) : null;
  const music = manifest.audio?.musicPath ? resolve(baseDir, manifest.audio.musicPath) : null;
  const aParts = [];
  let audioOut = "aout";

  if (vo && music) {
    inputArgs.push("-i", music);
    const musicIdx = idx++;
    inputArgs.push("-i", vo);
    const voIdx = idx++;
    aParts.push(`[${musicIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${total},apad=whole_dur=${total},volume=0.55[mus]`);
    aParts.push(`[${voIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[voa][vob]`);
    aParts.push("[mus][voa]sidechaincompress=threshold=0.02:ratio=6:attack=5:release=250[musd]");
    aParts.push("[musd][vob]amix=inputs=2:duration=first:normalize=0[amix]");
  } else if (music) {
    inputArgs.push("-i", music);
    const musicIdx = idx++;
    aParts.push(`[${musicIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${total},apad=whole_dur=${total}[amix]`);
  } else if (vo) {
    inputArgs.push("-i", vo);
    const voIdx = idx++;
    aParts.push(`[${voIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=${total},atrim=0:${total}[amix]`);
  } else {
    inputArgs.push("-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo`);
    idx++;
    aParts.push(`[${idx - 1}:a]atrim=0:${total}[amix]`);
  }
  aParts.push(mode === "final" ? "[amix]loudnorm=I=-14:TP=-1:LRA=11[aout]" : "[amix]anull[aout]");
  filters.push(...aParts);
  audioOut = "aout";

  const preset = mode === "final" ? "medium" : "ultrafast";
  const crf = mode === "final" ? "18" : "28";
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...inputArgs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${videoOut}]`,
    "-map",
    `[${audioOut}]`,
    "-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k",
    "-t", String(total),
    "-movflags", "+faststart",
    resolve(out),
  ];
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  if (!f.manifest || !f.out)
    throw new Error("Usage: assemble-cut.mjs --manifest <manifest.json> --mode rough|final|animatic [--hold <sec>] --out <file>");
  const mode = f.mode === "final" || f.mode === "animatic" ? f.mode : "rough";
  const manifest = JSON.parse(readFileSync(f.manifest, "utf8"));
  const baseDir = dirname(resolve(f.manifest));
  const outDir = dirname(resolve(f.out));
  mkdirSync(outDir, { recursive: true });
  const canBurn = mode === "final" && hasSubtitlesFilter();
  const hold = mode === "animatic" && f.hold ? Number(f.hold) : null;
  run(build(manifest, baseDir, mode, f.out, canBurn, hold), outDir);
  process.stdout.write(`Wrote ${f.out} (${mode}${mode === "final" && !canBurn ? ", captions as .srt sidecar" : ""})\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
