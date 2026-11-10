import { createHash } from "node:crypto";

type StrictStringReply = { _tag: "decoded"; fileContents: string } | { _tag: "invalid"; message: string };

const strictStringDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((leftByte, index) => leftByte === right[index]);

export const isNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const decodeUtf8 = (bytes: Uint8Array, filename: string): StrictStringReply => {
  try {
    return { _tag: "decoded", fileContents: strictStringDecoder.decode(bytes) };
  } catch (error) {
    const isErrorObject = error instanceof Error;
    const reason = isErrorObject ? error.message : String(error);

    return { _tag: "invalid", message: `${filename} is not strict UTF-8: ${reason}` };
  }
};

export const decodeStrictString = (bytes: Uint8Array, filename: string): StrictStringReply => {
  const utf8Reply = decodeUtf8(bytes, filename);

  const isDecodeFailed = utf8Reply._tag === "invalid";
  if (isDecodeFailed) {
    return utf8Reply;
  }

  const hasByteOrderMark = utf8Reply.fileContents.startsWith("\uFEFF");
  if (hasByteOrderMark) {
    return { _tag: "invalid", message: `${filename} must not start with a UTF-8 byte-order mark.` };
  }

  return utf8Reply;
};

export const readLineEnding = (fileMessages: string): "\r\n" | "\n" => {
  const hasCrlfEnding = fileMessages.includes("\r\n");

  return hasCrlfEnding ? "\r\n" : "\n";
};

// JSON.stringify replacer: a Uint8Array becomes its canonical base64 text, as the receipt stores it.
export const replaceBytesWithBase64 = (_key: string, documentCandidate: unknown): unknown => {
  const isBytesCandidate = documentCandidate instanceof Uint8Array;
  return isBytesCandidate ? Buffer.from(documentCandidate).toString("base64") : documentCandidate;
};
