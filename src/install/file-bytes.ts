/** Byte-level file facts every ownership check agrees on: hash, equality, absence, strict text, and line endings. */

import { createHash } from "node:crypto";

import type { PlatformError } from "@effect/platform/Error";
import { Either } from "effect";

const strictTextDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

export const isNotFound = (error: PlatformError): boolean =>
  error._tag === "SystemError" && error.reason === "NotFound";

export const decodeStrictText = (bytes: Uint8Array, filename: string): Either.Either<string, string> => {
  const decoded = Either.try({
    try: () => strictTextDecoder.decode(bytes),
    catch: (error) => `${filename} is not strict UTF-8: ${error instanceof Error ? error.message : String(error)}`,
  });

  return Either.flatMap(decoded, (source) =>
    source.startsWith("\uFEFF")
      ? Either.left(`${filename} must not start with a UTF-8 byte-order mark.`)
      : Either.right(source),
  );
};

export const lineEnding = (source: string): "\r\n" | "\n" => (source.includes("\r\n") ? "\r\n" : "\n");
