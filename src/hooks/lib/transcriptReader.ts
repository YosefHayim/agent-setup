// Agent transcripts hold one JSON object per line; scratch-folder-guard and session-rehome decode
// them here.

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";

// The newest turns sit at the end, so per-check readers look only at this much of a long transcript.
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
// A session's opening lines say where and how it started; Codex's first line alone is over 20 KB.
const TRANSCRIPT_HEAD_BYTES = 64 * 1024;
const LINE_FEED = 0x0a;

export type TokenUsage = {
  readonly inputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly outputTokens: number;
};

export type TranscriptEntry = {
  readonly isSidechain: boolean;
  /** Claude Code writes `type` ("user", "assistant", …); other agents write only `role`. */
  readonly type: string;
  readonly role: string;
  readonly model: string;
  readonly usage: TokenUsage | undefined;
  /** `message.content` when the entry wraps a message, else the entry's own `content`. */
  readonly content: unknown;
  readonly stopReason: string | null;
};

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const numberProperty = (record: Record<string, unknown>, property: string): number => {
  const candidate = record[property];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
};

const stringProperty = (record: Record<string, unknown>, property: string): string => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : "";
};

const decodeTokenUsage = (candidate: unknown): TokenUsage | undefined => {
  if (!isRecord(candidate)) {
    return undefined;
  }

  return {
    inputTokens: numberProperty(candidate, "input_tokens"),
    cacheCreationInputTokens: numberProperty(candidate, "cache_creation_input_tokens"),
    cacheReadInputTokens: numberProperty(candidate, "cache_read_input_tokens"),
    outputTokens: numberProperty(candidate, "output_tokens"),
  };
};

const decodeTranscriptEntry = (candidate: unknown): TranscriptEntry | undefined => {
  if (!isRecord(candidate)) {
    return undefined;
  }

  const message = isRecord(candidate.message) ? candidate.message : undefined;
  const stopReason = message?.stop_reason;
  return {
    isSidechain: candidate.isSidechain === true,
    type: stringProperty(candidate, "type"),
    role: stringProperty(candidate, "role"),
    model: message ? stringProperty(message, "model") : "",
    usage: message ? decodeTokenUsage(message.usage) : undefined,
    content: message ? message.content : candidate.content,
    stopReason: typeof stopReason === "string" ? stopReason : null,
  };
};

// A blank or malformed line gives undefined.
export const decodeTranscriptLine = (line: string): TranscriptEntry | undefined => {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return decodeTranscriptEntry(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
};

export const readTranscriptLines = (file: string): ReadonlyArray<string> => readFileSync(file, "utf8").split("\n");

type HeadRead = { readonly descriptor: number; readonly position: number };

const readHeadChunk = (read: HeadRead): Buffer => {
  const bytes = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
  const byteCount = readSync(read.descriptor, bytes, 0, TRANSCRIPT_HEAD_BYTES, read.position);
  return bytes.subarray(0, byteCount);
};

const restOfOpenLine = (read: HeadRead): ReadonlyArray<Buffer> => {
  const chunk = readHeadChunk(read);
  const lineEnd = chunk.indexOf(LINE_FEED);
  if (lineEnd !== -1) {
    return [chunk.subarray(0, lineEnd)];
  }

  if (chunk.length < TRANSCRIPT_HEAD_BYTES) {
    return [chunk];
  }

  const laterChunks = restOfOpenLine({ ...read, position: read.position + chunk.length });
  return [chunk, ...laterChunks];
};

// Every line that starts in the head is read whole, however long: a cut line would not parse.
export const readTranscriptHead = (file: string): ReadonlyArray<string> => {
  const descriptor = openSync(file, "r");
  try {
    const head = readHeadChunk({ descriptor, position: 0 });
    const openLineRest =
      head.length < TRANSCRIPT_HEAD_BYTES ? [] : restOfOpenLine({ descriptor, position: head.length });
    return Buffer.concat([head, ...openLineRest])
      .toString("utf8")
      .split("\n");
  } finally {
    closeSync(descriptor);
  }
};

// The first line of the tail may be cut short.
export const readTranscriptTail = (file: string): ReadonlyArray<string> => {
  const fileSize = statSync(file).size;
  const start = fileSize > TRANSCRIPT_TAIL_BYTES ? fileSize - TRANSCRIPT_TAIL_BYTES : 0;
  const byteCount = fileSize - start;
  const bytes = Buffer.allocUnsafe(byteCount);
  const descriptor = openSync(file, "r");
  try {
    readSync(descriptor, bytes, 0, byteCount, start);
  } finally {
    closeSync(descriptor);
  }
  return bytes.toString("utf8").split("\n");
};
