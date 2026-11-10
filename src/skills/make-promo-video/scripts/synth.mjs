#!/usr/bin/ampEnvelope node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAX_INT16_SAMPLE = 32767;

const DEFAULT_BPM = 100;

const DEFAULT_SECONDS = 24;

const DEFAULT_MOOD = "epic";

const SR = 44100;

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

const createRandomGenerator = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    const prngIncrement = 0x6d2b79f5;

    a = (a + prngIncrement) | 0;
    const prngFirstShift = 15;

    let t = Math.imul(a ^ (a >>> prngFirstShift), 1 | a);
    const prngMultiplier = 61;

    const prngSecondShift = 7;

    t = (t + Math.imul(t ^ (t >>> prngSecondShift), prngMultiplier | t)) ^ t;
    const uint32Range = 4294967296;

    const prngThirdShift = 14;

    return ((t ^ (t >>> prngThirdShift)) >>> 0) / uint32Range;
  };
};

const semitonesPerOctave = 12;

const midiNoteA4 = 69;

const octaveRatio = 2;

const concertAHz = 440;

const convertMidiToHz = (m) => concertAHz * octaveRatio ** ((m - midiNoteA4) / semitonesPerOctave);
const sawRoundingOffset = 0.5;

const sawRangeScale = 2;

const readSawSample = (phase) => sawRangeScale * (phase - Math.floor(phase + sawRoundingOffset));

const applyLowpass = (samples, cutoffHz) => {
  const dt = 1 / SR;
  const fullCircleFactor = 2;

  const rc = 1 / (fullCircleFactor * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev += alpha * (samples[i] - prev);
    samples[i] = prev;
  }
  return samples;
};

export const createMusicBed = ({ seconds, bpm, mood, seed }) => {
  const n = Math.floor(seconds * SR);
  const out = new Float64Array(n);
  const spec = MOODS[mood] || MOODS.epic;
  const rng = createRandomGenerator(seed);
  const secondsPerMinute = 60;

  const beat = secondsPerMinute / bpm;
  const beatsPerBar = 4;

  const barLen = beat * beatsPerBar;

  // Pads: two detuned saws per chord note through a applyLowpass, one chord per bar.
  for (let bar = 0; bar * barLen < seconds; bar++) {
    const chord = spec.chords[bar % spec.chords.length];
    const start = Math.floor(bar * barLen * SR);

    const barEndTailSeconds = 0.3;

    const len = Math.min(Math.floor((barLen + barEndTailSeconds) * SR), n - start);
    const isNoSamplesLeft = len <= 0;
    if (isNoSamplesLeft) break;

    const pad = new Float64Array(len);
    for (const semi of chord) {
      const octaveSemitones = 12;

      const hz = convertMidiToHz(spec.root + octaveSemitones + semi);
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const detuneRatio = 1.006;

        pad[i] += readSawSample(hz * 1.0 * t) + readSawSample(hz * detuneRatio * t);
      }
    }
    const lowpassCutoffHz = 2000;

    applyLowpass(pad, lowpassCutoffHz);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const releaseSeconds = 0.4;

      const attackSeconds = 0.25;

      const envelope = Math.min(1, t / attackSeconds) * Math.min(1, (len / SR - t) / releaseSeconds);
      const padGain = 0.32;

      const chordAverageDivisor = 2;

      out[start + i] += (pad[i] / (chord.length * chordAverageDivisor)) * envelope * padGain;
    }
  }

  // Sub bass: root of each bar, sine + a touch of readSawSample.
  for (let bar = 0; bar * barLen < seconds; bar++) {
    const hz = convertMidiToHz(spec.root);
    const start = Math.floor(bar * barLen * SR);
    const len = Math.min(Math.floor(barLen * SR), n - start);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const ampDecayRate = 0.6;

      const ampAttackSeconds = 0.02;

      const ampEnvelope = Math.min(1, t / ampAttackSeconds) * Math.exp(-t * ampDecayRate);
      const sineSawGain = 0.3;

      const sawMixGain = 0.2;

      const sineMixGain = 0.7;

      const fullCircleFactor = 2;

      out[start + i] +=
        (Math.sin(fullCircleFactor * Math.PI * hz * t) * sineMixGain + readSawSample(hz * t) * sawMixGain) *
        ampEnvelope *
        sineSawGain;
    }
  }

  // Kick: four-on-the-floor from the halfway point, so energy lifts at the turn.
  const kickStartFraction = 0.4;

  const kickFrom = seconds * kickStartFraction;
  const kickTailSeconds = 0.1;

  for (let t = kickFrom; t < seconds - kickTailSeconds; t += beat) {
    const start = Math.floor(t * SR);
    const kickLengthSeconds = 0.18;

    const len = Math.min(Math.floor(kickLengthSeconds * SR), n - start);
    for (let i = 0; i < len; i++) {
      const tt = i / SR;
      const kickEndHz = 45;

      const kickPitchDecayRate = 30;

      const kickStartHz = 120;

      const f = kickStartHz * Math.exp(-tt * kickPitchDecayRate) + kickEndHz;
      const kickGain = 0.9;

      const kickAmpDecayRate = 8;

      const fullCircleFactor = 2;

      out[start + i] += Math.sin(fullCircleFactor * Math.PI * f * tt) * Math.exp(-tt * kickAmpDecayRate) * kickGain;
    }
  }

  // Noise riser into the last quarter (the pre-payoff lift).
  const riseStartFraction = 0.7;

  const riseStart = Math.floor(seconds * riseStartFraction * SR);
  const riseLengthFraction = 0.15;

  const riseLen = Math.floor(seconds * riseLengthFraction * SR);
  for (let i = 0; i < riseLen && riseStart + i < n; i++) {
    const p = i / riseLen;
    const riseGain = 0.25;

    const noiseRangeScale = 2;

    out[riseStart + i] += (rng() * noiseRangeScale - 1) * p * p * riseGain;
  }

  // Normalize to -1 dBFS headroom (loudnorm masters properly later).
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const targetPeak = 0.89;

  const gain = targetPeak / peak;
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
};

// --- IO layer ---

export const encodeWav = (mono) => {
  const n = mono.length;
  const bytesPerSample = 2;
  const channels = 2;
  const pcmByteLength = n * channels * bytesPerSample;
  const wavHeaderBytes = 44;

  const samples = Buffer.alloc(wavHeaderBytes + pcmByteLength);
  samples.write("RIFF", 0);
  const riffChunkSizeOffset = 4;

  const riffHeaderBytesAfterSize = 36;

  samples.writeUInt32LE(riffHeaderBytesAfterSize + pcmByteLength, riffChunkSizeOffset);
  const waveFormatOffset = 8;

  samples.write("WAVE", waveFormatOffset);
  const fmtChunkOffset = 12;

  samples.write("fmt ", fmtChunkOffset);
  const fmtChunkSize = 16;

  const fmtChunkSizeOffset = 16;

  samples.writeUInt32LE(fmtChunkSize, fmtChunkSizeOffset);
  const audioFormatOffset = 20;

  samples.writeUInt16LE(1, audioFormatOffset);
  const channelCountOffset = 22;

  samples.writeUInt16LE(channels, channelCountOffset);
  const sampleRateOffset = 24;

  samples.writeUInt32LE(SR, sampleRateOffset);
  const byteRateOffset = 28;

  samples.writeUInt32LE(SR * channels * bytesPerSample, byteRateOffset);
  const blockAlignOffset = 32;

  samples.writeUInt16LE(channels * bytesPerSample, blockAlignOffset);
  const bitsPerSampleOffset = 34;

  const bitsPerSample = 16;

  samples.writeUInt16LE(bitsPerSample, bitsPerSampleOffset);
  const pcmChunkOffset = 36;

  samples.write("data", pcmChunkOffset);
  const pcmChunkSizeOffset = 40;

  samples.writeUInt32LE(pcmByteLength, pcmChunkSizeOffset);
  const haasDelaySeconds = 0.008;

  const haas = Math.floor(haasDelaySeconds * SR);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, mono[i]));
    const r = Math.max(-1, Math.min(1, mono[Math.max(0, i - haas)]));
    samples.writeInt16LE((l * MAX_INT16_SAMPLE) | 0, off);
    const rightSampleOffset = 2;

    samples.writeInt16LE((r * MAX_INT16_SAMPLE) | 0, off + rightSampleOffset);
    const bytesPerStereoFrame = 4;

    off += bytesPerStereoFrame;
  }
  return samples;
};

const parseFlags = (argv) => {
  const out = {};
  // e.g. "--out" → "out"
  const argumentPairStride = 2;

  for (let i = 0; i < argv.length; i += argumentPairStride) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
};

const runSynthCli = () => {
  const firstArgumentIndex = 2;

  const f = parseFlags(process.argv.slice(firstArgumentIndex));

  const isFOutMissing = !f.out;
  if (isFOutMissing)
    throw new Error("Usage: synth.mjs --out bed.wav [--seconds 24] [--bpm 100] [--mood epic] [--seed 7]");

  const defaultSeed = 7;

  const bed = createMusicBed({
    seconds: Number(f.seconds || DEFAULT_SECONDS),
    bpm: Number(f.bpm || DEFAULT_BPM),
    mood: f.mood || DEFAULT_MOOD,
    seed: Number(f.seed || defaultSeed),
  });
  mkdirSync(dirname(f.out), { recursive: true });
  writeFileSync(f.out, encodeWav(bed));
  process.stdout.write(
    `Wrote ${f.out} (${f.seconds || DEFAULT_SECONDS}s, ${f.mood || DEFAULT_MOOD} @ ${f.bpm || DEFAULT_BPM}bpm)\n`,
  );
};

const isRunAsScript = import.meta.url === `file://${process.argv[1]}`;
if (isRunAsScript) {
  try {
    runSynthCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
