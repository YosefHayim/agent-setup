#!/usr/bin/ampEnvelope node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAX_INT16_SAMPLE = 32767;

const DEFAULT_BPM = 100;

const DEFAULT_SECONDS = 24;

const DEFAULT_MOOD = "epic";

const SAMPLE_RATE = 44100;

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
  let prngState = seed >>> 0;
  return () => {
    prngState |= 0;
    const prngIncrement = 0x6d2b79f5;

    prngState = (prngState + prngIncrement) | 0;
    const prngFirstShift = 15;

    let mixedState = Math.imul(prngState ^ (prngState >>> prngFirstShift), 1 | prngState);
    const prngMultiplier = 61;

    const prngSecondShift = 7;

    mixedState =
      (mixedState + Math.imul(mixedState ^ (mixedState >>> prngSecondShift), prngMultiplier | mixedState)) ^ mixedState;
    const uint32Range = 4294967296;

    const prngThirdShift = 14;

    return ((mixedState ^ (mixedState >>> prngThirdShift)) >>> 0) / uint32Range;
  };
};

const semitonesPerOctave = 12;

const midiNoteA4 = 69;

const octaveRatio = 2;

const concertAHz = 440;

const convertMidiToHz = (midiNote) => concertAHz * octaveRatio ** ((midiNote - midiNoteA4) / semitonesPerOctave);
const sawRoundingOffset = 0.5;

const sawRangeScale = 2;

const readSawSample = (phase) => sawRangeScale * (phase - Math.floor(phase + sawRoundingOffset));

const applyLowpass = (samples, cutoffHz) => {
  const secondsPerSample = 1 / SAMPLE_RATE;
  const fullCircleFactor = 2;

  const timeConstantSeconds = 1 / (fullCircleFactor * Math.PI * cutoffHz);
  const alpha = secondsPerSample / (timeConstantSeconds + secondsPerSample);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev += alpha * (samples[i] - prev);
    samples[i] = prev;
  }
  return samples;
};

export const createMusicBed = ({ seconds, bpm, mood, seed }) => {
  const totalSampleCount = Math.floor(seconds * SAMPLE_RATE);
  const bedSamples = new Float64Array(totalSampleCount);
  const spec = MOODS[mood] || MOODS.epic;
  const randomNumberGenerator = createRandomGenerator(seed);
  const secondsPerMinute = 60;

  const beat = secondsPerMinute / bpm;
  const beatsPerBar = 4;

  const barLen = beat * beatsPerBar;

  // Pads: two detuned saws per chord note through a applyLowpass, one chord per bar.
  for (let barIndex = 0; barIndex * barLen < seconds; barIndex++) {
    const chord = spec.chords[barIndex % spec.chords.length];
    const start = Math.floor(barIndex * barLen * SAMPLE_RATE);

    const barEndTailSeconds = 0.3;

    const padSampleCount = Math.min(Math.floor((barLen + barEndTailSeconds) * SAMPLE_RATE), totalSampleCount - start);
    const isNoSamplesLeft = padSampleCount <= 0;
    if (isNoSamplesLeft) break;

    const padSamples = new Float64Array(padSampleCount);
    for (const semi of chord) {
      const octaveSemitones = 12;

      const frequencyHz = convertMidiToHz(spec.root + octaveSemitones + semi);
      for (let i = 0; i < padSampleCount; i++) {
        const timeSeconds = i / SAMPLE_RATE;
        const detuneRatio = 1.006;

        padSamples[i] +=
          readSawSample(frequencyHz * 1.0 * timeSeconds) + readSawSample(frequencyHz * detuneRatio * timeSeconds);
      }
    }
    const lowpassCutoffHz = 2000;

    applyLowpass(padSamples, lowpassCutoffHz);
    for (let i = 0; i < padSampleCount; i++) {
      const timeSeconds = i / SAMPLE_RATE;
      const releaseSeconds = 0.4;

      const attackSeconds = 0.25;

      const envelope =
        Math.min(1, timeSeconds / attackSeconds) *
        Math.min(1, (padSampleCount / SAMPLE_RATE - timeSeconds) / releaseSeconds);
      const padGain = 0.32;

      const chordAverageDivisor = 2;

      bedSamples[start + i] += (padSamples[i] / (chord.length * chordAverageDivisor)) * envelope * padGain;
    }
  }

  // Sub bass: root of each bar, sine + a touch of readSawSample.
  for (let barIndex = 0; barIndex * barLen < seconds; barIndex++) {
    const frequencyHz = convertMidiToHz(spec.root);
    const start = Math.floor(barIndex * barLen * SAMPLE_RATE);
    const bassSampleCount = Math.min(Math.floor(barLen * SAMPLE_RATE), totalSampleCount - start);
    for (let i = 0; i < bassSampleCount; i++) {
      const timeSeconds = i / SAMPLE_RATE;
      const ampDecayRate = 0.6;

      const ampAttackSeconds = 0.02;

      const ampEnvelope = Math.min(1, timeSeconds / ampAttackSeconds) * Math.exp(-timeSeconds * ampDecayRate);
      const sineSawGain = 0.3;

      const sawMixGain = 0.2;

      const sineMixGain = 0.7;

      const fullCircleFactor = 2;

      bedSamples[start + i] +=
        (Math.sin(fullCircleFactor * Math.PI * frequencyHz * timeSeconds) * sineMixGain +
          readSawSample(frequencyHz * timeSeconds) * sawMixGain) *
        ampEnvelope *
        sineSawGain;
    }
  }

  // Kick: four-on-the-floor from the halfway point, so energy lifts at the turn.
  const kickStartFraction = 0.4;

  const kickFrom = seconds * kickStartFraction;
  const kickTailSeconds = 0.1;

  for (let kickTimeSeconds = kickFrom; kickTimeSeconds < seconds - kickTailSeconds; kickTimeSeconds += beat) {
    const start = Math.floor(kickTimeSeconds * SAMPLE_RATE);
    const kickLengthSeconds = 0.18;

    const kickSampleCount = Math.min(Math.floor(kickLengthSeconds * SAMPLE_RATE), totalSampleCount - start);
    for (let i = 0; i < kickSampleCount; i++) {
      const kickElapsedSeconds = i / SAMPLE_RATE;
      const kickEndHz = 45;

      const kickPitchDecayRate = 30;

      const kickStartHz = 120;

      const kickFrequencyHz = kickStartHz * Math.exp(-kickElapsedSeconds * kickPitchDecayRate) + kickEndHz;
      const kickGain = 0.9;

      const kickAmpDecayRate = 8;

      const fullCircleFactor = 2;

      bedSamples[start + i] +=
        Math.sin(fullCircleFactor * Math.PI * kickFrequencyHz * kickElapsedSeconds) *
        Math.exp(-kickElapsedSeconds * kickAmpDecayRate) *
        kickGain;
    }
  }

  // Noise riser into the last quarter (the pre-payoff lift).
  const riseStartFraction = 0.7;

  const riseStart = Math.floor(seconds * riseStartFraction * SAMPLE_RATE);
  const riseLengthFraction = 0.15;

  const riseLen = Math.floor(seconds * riseLengthFraction * SAMPLE_RATE);
  for (let i = 0; i < riseLen && riseStart + i < totalSampleCount; i++) {
    const riseProgress = i / riseLen;
    const riseGain = 0.25;

    const noiseRangeScale = 2;

    bedSamples[riseStart + i] +=
      (randomNumberGenerator() * noiseRangeScale - 1) * riseProgress * riseProgress * riseGain;
  }

  // Normalize to -1 dBFS headroom (loudnorm masters properly later).
  let peak = 1e-9;
  for (let i = 0; i < totalSampleCount; i++) peak = Math.max(peak, Math.abs(bedSamples[i]));
  const targetPeak = 0.89;

  const gain = targetPeak / peak;
  for (let i = 0; i < totalSampleCount; i++) bedSamples[i] *= gain;
  return bedSamples;
};

// --- IO layer ---

export const encodeWav = (mono) => {
  const sampleCount = mono.length;
  const bytesPerSample = 2;
  const channels = 2;
  const pcmByteLength = sampleCount * channels * bytesPerSample;
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

  samples.writeUInt32LE(SAMPLE_RATE, sampleRateOffset);
  const byteRateOffset = 28;

  samples.writeUInt32LE(SAMPLE_RATE * channels * bytesPerSample, byteRateOffset);
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

  const haas = Math.floor(haasDelaySeconds * SAMPLE_RATE);
  let byteOffset = 44;
  for (let i = 0; i < sampleCount; i++) {
    const leftSample = Math.max(-1, Math.min(1, mono[i]));
    const rightSample = Math.max(-1, Math.min(1, mono[Math.max(0, i - haas)]));
    samples.writeInt16LE((leftSample * MAX_INT16_SAMPLE) | 0, byteOffset);
    const rightSampleOffset = 2;

    samples.writeInt16LE((rightSample * MAX_INT16_SAMPLE) | 0, byteOffset + rightSampleOffset);
    const bytesPerStereoFrame = 4;

    byteOffset += bytesPerStereoFrame;
  }
  return samples;
};

const parseFlags = (argv) => {
  const parsedFlags = {};
  // e.g. "--out" → "out"
  const argumentPairStride = 2;

  for (let i = 0; i < argv.length; i += argumentPairStride) parsedFlags[argv[i].replace(/^--/, "")] = argv[i + 1];
  return parsedFlags;
};

const runSynthCli = () => {
  const firstArgumentIndex = 2;

  const flags = parseFlags(process.argv.slice(firstArgumentIndex));

  const isOutFlagMissing = !flags.out;
  if (isOutFlagMissing)
    throw new Error("Usage: synth.mjs --out bed.wav [--seconds 24] [--bpm 100] [--mood epic] [--seed 7]");

  const defaultSeed = 7;

  const musicBed = createMusicBed({
    seconds: Number(flags.seconds || DEFAULT_SECONDS),
    bpm: Number(flags.bpm || DEFAULT_BPM),
    mood: flags.mood || DEFAULT_MOOD,
    seed: Number(flags.seed || defaultSeed),
  });
  mkdirSync(dirname(flags.out), { recursive: true });
  writeFileSync(flags.out, encodeWav(musicBed));
  process.stdout.write(
    `Wrote ${flags.out} (${flags.seconds || DEFAULT_SECONDS}s, ${flags.mood || DEFAULT_MOOD} @ ${flags.bpm || DEFAULT_BPM}bpm)\n`,
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
