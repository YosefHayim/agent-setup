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

export type TranscriptLine = {
  readonly isSidechain: boolean;
  /** Claude Code writes `type` ("user", "assistant", …); other agents write only `role`. */
  readonly type: string;
  readonly role: string;
  readonly model: string;
  readonly usage: TokenUsage | null;
  /** `message.content` when the entry wraps a message, else the entry's own `content`. */
  readonly content: unknown;
  readonly stopReason: string | null;
};

const isPlainObject = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const readNumberProperty = (fields: Record<string, unknown>, property: string): number => {
  const candidate = fields[property];

  const isFiniteNumber = typeof candidate === "number" && Number.isFinite(candidate);
  return isFiniteNumber ? candidate : 0;
};

const readStringProperty = (fields: Record<string, unknown>, property: string): string => {
  const candidate = fields[property];

  const isStringCandidate = typeof candidate === "string";
  return isStringCandidate ? candidate : "";
};

const decodeTokenUsage = (candidate: unknown): TokenUsage | null => {
  const isNotPlainObject = !isPlainObject(candidate);
  if (isNotPlainObject) {
    return null;
  }

  return {
    inputTokens: readNumberProperty(candidate, "input_tokens"),
    cacheCreationInputTokens: readNumberProperty(candidate, "cache_creation_input_tokens"),
    cacheReadInputTokens: readNumberProperty(candidate, "cache_read_input_tokens"),
    outputTokens: readNumberProperty(candidate, "output_tokens"),
  };
};

const decodeTranscriptObject = (candidate: unknown): TranscriptLine | null => {
  const isNotPlainObject = !isPlainObject(candidate);
  if (isNotPlainObject) {
    return null;
  }

  const message = isPlainObject(candidate.message) ? candidate.message : null;
  const hasMessage = message != null;
  const stopReason = message?.stop_reason;
  const isStopReasonString = typeof stopReason === "string";
  return {
    isSidechain: candidate.isSidechain === true,
    type: readStringProperty(candidate, "type"),
    role: readStringProperty(candidate, "role"),
    model: hasMessage ? readStringProperty(message, "model") : "",
    usage: hasMessage ? decodeTokenUsage(message.usage) : null,
    content: hasMessage ? message.content : candidate.content,
    stopReason: isStopReasonString ? stopReason : null,
  };
};

// A blank or malformed line gives null.
export const decodeTranscriptLine = (line: string): TranscriptLine | null => {
  const trimmed = line.trim();

  const isTrimmedBlank = !trimmed;
  if (isTrimmedBlank) {
    return null;
  }

  try {
    return decodeTranscriptObject(JSON.parse(trimmed));
  } catch {
    return null;
  }
};

export const readTranscriptLines = (file: string): ReadonlyArray<string> => readFileSync(file, "utf8").split("\n");

type HeadRead = { readonly descriptor: number; readonly position: number };

const readHeadChunk = (read: HeadRead): Buffer => {
  const bytes = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
  const byteCount = readSync(read.descriptor, bytes, 0, TRANSCRIPT_HEAD_BYTES, read.position);
  return bytes.subarray(0, byteCount);
};

const listRestOfOpenLine = (read: HeadRead): ReadonlyArray<Buffer> => {
  const chunk = readHeadChunk(read);

  const lineEnd = chunk.indexOf(LINE_FEED);

  const hasLineEnd = lineEnd !== -1;
  if (hasLineEnd) {
    return [chunk.subarray(0, lineEnd)];
  }

  const isShortChunk = chunk.length < TRANSCRIPT_HEAD_BYTES;
  if (isShortChunk) {
    return [chunk];
  }

  const laterChunks = listRestOfOpenLine({ ...read, position: read.position + chunk.length });
  return [chunk, ...laterChunks];
};

// Every line that starts in the head is read whole, however long: a cut line would not parse.
export const readTranscriptHead = (file: string): ReadonlyArray<string> => {
  const descriptor = openSync(file, "r");
  try {
    const head = readHeadChunk({ descriptor, position: 0 });
    const isHeadShort = head.length < TRANSCRIPT_HEAD_BYTES;
    const openLineRest = isHeadShort ? [] : listRestOfOpenLine({ descriptor, position: head.length });
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

  const isFileLargerThanTail = fileSize > TRANSCRIPT_TAIL_BYTES;
  const start = isFileLargerThanTail ? fileSize - TRANSCRIPT_TAIL_BYTES : 0;
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
