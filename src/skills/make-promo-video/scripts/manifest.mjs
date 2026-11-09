#!/usr/bin/env node
/**
 * Generation manifest — the resumable source of truth for one trailer build.
 *
 * Pure transformers up top, an IO + CLI shell at the bottom (see the divider).
 * Zero dependencies; Node >= 20. The agent patches this file as jobs land, so a
 * dead render resumes by re-running a phase and only regenerating pending scenes.
 *
 * Usage:
 *   node manifest.mjs init  --dir <dir> --project <name> [--seconds 24] [--mode hybrid|cinematic]
 *   node manifest.mjs show  --dir <dir>
 *   node manifest.mjs pending-stills --dir <dir>
 *   node manifest.mjs pending-clips  --dir <dir>
 *   node manifest.mjs add-scene --dir <dir> --json '<scene fields>'
 *   node manifest.mjs set   --dir <dir> --id s01 --key stillStatus --value done
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Build an empty manifest for a new trailer version. */
export function emptyManifest(meta = {}) {
  return {
    version: 1,
    project: meta.project || "",
    createdAt: meta.createdAt || new Date().toISOString(),
    format: {
      aspect: "9:16",
      fps: 30,
      width: 1080,
      height: 1920,
      targetSeconds: meta.targetSeconds || 24,
    },
    creativeMode: meta.creativeMode || "hybrid",
    conversation: null,
    style: { bibleImage: null, refs: [] },
    audio: { voPath: null, musicPath: null, voice: null, voProvider: null, musicProvider: null },
    scenes: [],
    variants: [],
  };
}

/** A blank scene at position `order` (1-based), with every field the pipeline reads. */
export function sceneTemplate(order) {
  return {
    id: `s${String(order).padStart(2, "0")}`,
    order,
    beat: "",
    durationSec: 3,
    shot: "",
    voLine: "",
    caption: "",
    musicCue: "",
    source: "ai",
    screenshot: null,
    motion: "kenburns",
    motionEngine: null,
    stillPath: null,
    stillStatus: "pending",
    clipPath: null,
    clipJobId: null,
    clipStatus: "pending",
  };
}

/** Scenes whose AI keyframe still needs generating. */
export function pendingStills(m) {
  return m.scenes.filter((s) => s.source === "ai" && s.stillStatus !== "done");
}

/** Scenes whose motion clip still needs rendering. */
export function pendingClips(m) {
  return m.scenes.filter((s) => s.motion === "clip" && s.clipStatus !== "done");
}

/** Return a copy of `m` with scene `id` shallow-merged with `patch`. */
export function patchScene(m, id, patch) {
  return { ...m, scenes: m.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** Append a scene, deriving its id/order from the current count. */
export function addScene(m, fields = {}) {
  const scene = { ...sceneTemplate(m.scenes.length + 1), ...fields };
  return { ...m, scenes: [...m.scenes, scene] };
}

// --- IO layer ---

const manifestPath = (dir) => join(dir, "manifest.json");

function load(dir) {
  const p = manifestPath(dir);
  if (!existsSync(p)) throw new Error(`No manifest at ${p} — run 'init' first.`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function save(dir, m) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "build"), { recursive: true });
  writeFileSync(manifestPath(dir), `${JSON.stringify(m, null, 2)}\n`);
}

function parseFlags(argv) {
  const out = {};
  // e.g. "--manifest" → "manifest"
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = parseFlags(rest);
  const dir = f.dir;
  if (!cmd || !dir) throw new Error("Usage: manifest.mjs <cmd> --dir <dir> [...]");

  if (cmd === "init") {
    const m = emptyManifest({ project: f.project, targetSeconds: coerce(f.seconds), creativeMode: f.mode });
    save(dir, m);
    process.stdout.write(`Initialized ${manifestPath(dir)}\n`);
    return;
  }

  const m = load(dir);
  if (cmd === "show") process.stdout.write(`${JSON.stringify(m, null, 2)}\n`);
  else if (cmd === "pending-stills")
    process.stdout.write(
      `${pendingStills(m)
        .map((s) => s.id)
        .join(" ")}\n`,
    );
  else if (cmd === "pending-clips")
    process.stdout.write(
      `${pendingClips(m)
        .map((s) => s.id)
        .join(" ")}\n`,
    );
  else if (cmd === "add-scene") save(dir, addScene(m, JSON.parse(f.json || "{}")));
  else if (cmd === "set") {
    if (!f.id || !f.key) throw new Error("set needs --id and --key (and --value)");
    save(dir, patchScene(m, f.id, { [f.key]: coerce(f.value || "") }));
    process.stdout.write(`Set ${f.id}.${f.key} = ${f.value}\n`);
  } else throw new Error(`Unknown command: ${cmd}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
