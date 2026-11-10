import { readFile } from "node:fs/promises";

import { joinZodIssueMessages } from "#src/zod-issue-messages.js";
import { bytesEqual, hashBytes, isNotFound } from "./file-bytes.js";
import { createInstallError } from "./install-request.js";
import type { FileOwner, OwnedFile, PreviousFileValue } from "./ownership.js";
import { type ExpectedCurrent, type FileChange, fileChangeSchema } from "./plan.js";
import type { Receipt } from "./receipt.js";

export const applicationOwner = { _tag: "application" } as const satisfies FileOwner;

interface MissingFileSnapshot {
  readonly _tag: "missing";
}

interface ExistingFileSnapshot {
  readonly _tag: "file";
  readonly bytes: Uint8Array;
}

export type FileSnapshot = MissingFileSnapshot | ExistingFileSnapshot;

export const readFileSnapshot = async (filePath: string): Promise<FileSnapshot> => {
  try {
    const fileBytes = await readFile(filePath);

    return { _tag: "file", bytes: fileBytes };
  } catch (readError) {
    const isReadFailure = !isNotFound(readError);
    if (isReadFailure) {
      throw readError;
    }

    return { _tag: "missing" };
  }
};

export const readExpectedCurrent = (snapshot: FileSnapshot): ExpectedCurrent => {
  const isMissing = snapshot._tag === "missing";

  return isMissing ? { _tag: "missing" } : { _tag: "file", sha256: hashBytes(snapshot.bytes) };
};

export const readPreviousFileField = (snapshot: FileSnapshot): PreviousFileValue => {
  const isMissing = snapshot._tag === "missing";

  return isMissing ? { _tag: "missing" } : { _tag: "priorFile", bytes: snapshot.bytes };
};

export const checkFileChange = (uncheckedChange: unknown): FileChange => {
  const changeCheck = fileChangeSchema.safeParse(uncheckedChange);

  const isChangeInvalid = !changeCheck.success;
  if (isChangeInvalid) {
    throw createInstallError(`Generated file change is invalid: ${joinZodIssueMessages(changeCheck.error)}`);
  }

  return changeCheck.data;
};

export const readPreviousReceiptFile = (receipt: Receipt | null, filePath: string): OwnedFile | null => {
  const isReceiptMissing = receipt == null;
  if (isReceiptMissing) {
    return null;
  }

  return receipt.ownedFiles.find((file) => file.path === filePath) ?? null;
};

// A receipted file that already holds the bytes about to be written is adopted, not refused: an external
// skill sync can reproduce our content, and rewriting identical bytes destroys nothing.
export const readPreviousWholeFile = (previousRead: {
  receipt: Receipt | null;
  filePath: string;
  snapshot: FileSnapshot;
  desiredBytes: Uint8Array | null;
}): PreviousFileValue => {
  const file = readPreviousReceiptFile(previousRead.receipt, previousRead.filePath);

  const isNewFile = file == null;
  if (isNewFile) {
    return readPreviousFileField(previousRead.snapshot);
  }

  const ownership = file.ownership;

  const isOwnershipIncompatible = ownership._tag !== "wholeFile";
  if (isOwnershipIncompatible) {
    throw createInstallError(`Receipted whole-file file ${previousRead.filePath} has incompatible ownership.`);
  }

  const snapshot = previousRead.snapshot;
  const isSnapshotFile = snapshot._tag === "file";
  const isInstalledBytes = isSnapshotFile && hashBytes(snapshot.bytes) === ownership.installedHash;
  const isDesiredBytes =
    isSnapshotFile && previousRead.desiredBytes != null && bytesEqual(snapshot.bytes, previousRead.desiredBytes);

  const isChangedAfterInstall = !isInstalledBytes && !isDesiredBytes;
  if (isChangedAfterInstall) {
    throw createInstallError(`Receipted whole-file file ${previousRead.filePath} changed after installation.`);
  }

  return ownership.previous;
};
