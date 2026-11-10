import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

export const isPlainObject = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

// A blank, cut-short, or non-object line decodes to an empty record.
export const decodeLine = (line: string): Record<string, unknown> => {
  try {
    const candidate: unknown = JSON.parse(line);
    return isPlainObject(candidate) ? candidate : {};
  } catch {
    return {};
  }
};

const isEndingWithNewline = (file: string): boolean => {
  const isFilePresent = existsSync(file);
  const size = isFilePresent ? statSync(file).size : 0;

  const isEmptyFile = size === 0;
  if (isEmptyFile) {
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
export const appendLine = (request: { readonly file: string; readonly line: Record<string, unknown> }): void => {
  appendFileSync(request.file, `${isEndingWithNewline(request.file) ? "" : "\n"}${JSON.stringify(request.line)}\n`);
};
