// Transcripts, rollouts, the ledger, and Claude's history file are all one JSON object per line.

import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

export const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

// A blank, cut-short, or non-object line decodes to an empty record.
export const decodeJsonLine = (line: string): Record<string, unknown> => {
  try {
    const candidate: unknown = JSON.parse(line);
    return isRecord(candidate) ? candidate : {};
  } catch {
    return {};
  }
};

const endsWithNewline = (file: string): boolean => {
  const size = existsSync(file) ? statSync(file).size : 0;
  if (size === 0) {
    return true;
  }

  const descriptor = openSync(file, "r");
  try {
    const lastByte = Buffer.alloc(1);
    readSync(descriptor, lastByte, 0, 1, size - 1);
    return lastByte[0] === 0x0a;
  } finally {
    closeSync(descriptor);
  }
};

// A writer that died mid-line leaves no trailing newline; starting a fresh line keeps both records parseable.
export const appendJsonLine = (request: { readonly file: string; readonly line: Record<string, unknown> }): void => {
  appendFileSync(request.file, `${endsWithNewline(request.file) ? "" : "\n"}${JSON.stringify(request.line)}\n`);
};
