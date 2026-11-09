#!/usr/bin/env node
/**
 * Local music-bed fallback — the last link in the audio chain (no ElevenLabs
 * key, no Higgsfield credits). Zero dependencies: it writes a 16-bit stereo WAV
 * directly. It is a bed, not a score — ffmpeg (`assemble-cut.mjs`) masters it to
 * -14 LUFS / -1 dBTP and ducks it under the voiceover.
 *
 * Usage: node synth.mjs --out bed.wav [--seconds 24] [--bpm 100] [--mood epic|warm|tense|playful] [--seed 7]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SR = 44100;

/** Chord progressions (semitone offsets from the root) per mood, plus a root MIDI note. */
const MOODS = {
  epic: {
    root: 45,
    chords: [
      [0, 7, 12],
      [-4, 3, 8],
      [-7, 0, 5],
      [-2, 5, 10],
    ],
  },
  warm: {
    root: 48,
    chords: [
      [0, 4, 7],
      [-3, 2, 9],
      [-5, 0, 4],
      [2, 5, 9],
    ],
  },
  tense: {
    root: 43,
    chords: [
      [0, 6, 10],
      [0, 5, 11],
      [-2, 4, 10],
      [-1, 6, 9],
    ],
  },
  playful: {
    root: 52,
    chords: [
      [0, 4, 7],
      [5, 9, 12],
      [-3, 4, 7],
      [2, 7, 11],
    ],
  },
};

/** Small deterministic PRNG so a given --seed is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);
const saw = (phase) => 2 * (phase - Math.floor(phase + 0.5));

/** One-pole lowpass over a Float64 buffer. */
function lowpass(buf, cutoffHz) {
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    prev += alpha * (buf[i] - prev);
    buf[i] = prev;
  }
  return buf;
}

/** Render a mono mix for the whole bed. */
export function renderBed({ seconds, bpm, mood, seed }) {
  const n = Math.floor(seconds * SR);
  const out = new Float64Array(n);
  const spec = MOODS[mood] || MOODS.epic;
  const rng = mulberry32(seed);
  const beat = 60 / bpm;
  const barLen = beat * 4;

  // Pads: two detuned saws per chord note through a lowpass, one chord per bar.
  for (let bar = 0; bar * barLen < seconds; bar++) {
    const chord = spec.chords[bar % spec.chords.length];
    const start = Math.floor(bar * barLen * SR);
    const len = Math.min(Math.floor((barLen + 0.3) * SR), n - start);
    if (len <= 0) break;
    const pad = new Float64Array(len);
    for (const semi of chord) {
      const hz = midiToHz(spec.root + 12 + semi);
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        pad[i] += saw(hz * 1.0 * t) + saw(hz * 1.006 * t);
      }
    }
    lowpass(pad, 2000);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.25) * Math.min(1, (len / SR - t) / 0.4);
      out[start + i] += (pad[i] / (chord.length * 2)) * env * 0.32;
    }
  }

  // Sub bass: root of each bar, sine + a touch of saw.
  for (let bar = 0; bar * barLen < seconds; bar++) {
    const hz = midiToHz(spec.root);
    const start = Math.floor(bar * barLen * SR);
    const len = Math.min(Math.floor(barLen * SR), n - start);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.02) * Math.exp(-t * 0.6);
      out[start + i] += (Math.sin(2 * Math.PI * hz * t) * 0.7 + saw(hz * t) * 0.2) * env * 0.3;
    }
  }

  // Kick: four-on-the-floor from the halfway point, so energy lifts at the turn.
  const kickFrom = seconds * 0.4;
  for (let t = kickFrom; t < seconds - 0.1; t += beat) {
    const start = Math.floor(t * SR);
    const len = Math.min(Math.floor(0.18 * SR), n - start);
    for (let i = 0; i < len; i++) {
      const tt = i / SR;
      const f = 120 * Math.exp(-tt * 30) + 45;
      out[start + i] += Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 8) * 0.9;
    }
  }

  // Noise riser into the last quarter (the pre-payoff lift).
  const riseStart = Math.floor(seconds * 0.7 * SR);
  const riseLen = Math.floor(seconds * 0.15 * SR);
  for (let i = 0; i < riseLen && riseStart + i < n; i++) {
    const p = i / riseLen;
    out[riseStart + i] += (rng() * 2 - 1) * p * p * 0.25;
  }

  // Normalize to -1 dBFS headroom (loudnorm masters properly later).
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = 0.89 / peak;
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
}

// --- IO layer ---

/** Encode a mono Float64 buffer as a 16-bit stereo PCM WAV (Haas-widened). */
export function encodeWav(mono) {
  const n = mono.length;
  const bytesPerSample = 2;
  const channels = 2;
  const pcmByteLength = n * channels * bytesPerSample;
  const buf = Buffer.alloc(44 + pcmByteLength);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + pcmByteLength, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(pcmByteLength, 40);
  const haas = Math.floor(0.008 * SR);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, mono[i]));
    const r = Math.max(-1, Math.min(1, mono[Math.max(0, i - haas)]));
    buf.writeInt16LE((l * 32767) | 0, off);
    buf.writeInt16LE((r * 32767) | 0, off + 2);
    off += 4;
  }
  return buf;
}

function parseFlags(argv) {
  const out = {};
  // e.g. "--out" → "out"
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  if (!f.out) throw new Error("Usage: synth.mjs --out bed.wav [--seconds 24] [--bpm 100] [--mood epic] [--seed 7]");
  const bed = renderBed({
    seconds: Number(f.seconds || 24),
    bpm: Number(f.bpm || 100),
    mood: f.mood || "epic",
    seed: Number(f.seed || 7),
  });
  mkdirSync(dirname(f.out), { recursive: true });
  writeFileSync(f.out, encodeWav(bed));
  process.stdout.write(`Wrote ${f.out} (${f.seconds || 24}s, ${f.mood || "epic"} @ ${f.bpm || 100}bpm)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
