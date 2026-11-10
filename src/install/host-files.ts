/** Host files as install sees them: snapshot, expected-current guard, prior value, and checked file change. */

import { readFile } from "node:fs/promises";

import { joinZodIssueMessages } from "../zod-issue-messages.js";
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

export const expectedCurrent = (snapshot: FileSnapshot): ExpectedCurrent => {
  const isMissing = snapshot._tag === "missing";

  return isMissing ? { _tag: "missing" } : { _tag: "file", sha256: hashBytes(snapshot.bytes) };
};

export const previousFileValue = (snapshot: FileSnapshot): PreviousFileValue => {
  const isMissing = snapshot._tag === "missing";

  return isMissing ? { _tag: "missing" } : { _tag: "priorFile", bytes: snapshot.bytes };
};

export const checkFileChange = (input: unknown): FileChange => {
  const changeCheck = fileChangeSchema.safeParse(input);
  const isChangeInvalid = !changeCheck.success;
  if (isChangeInvalid) {
    throw createInstallError(`Generated file change is invalid: ${joinZodIssueMessages(changeCheck.error)}`);
  }

  return changeCheck.data;
};

export const previousReceiptFile = (receipt: Receipt | undefined, filePath: string): OwnedFile | undefined =>
  receipt?.ownedFiles.find((file) => file.path === filePath);

// A receipted file that already holds the bytes about to be written is adopted, not refused: an external
// skill sync can reproduce our content, and rewriting identical bytes destroys nothing.
export const previousWholeFile = (input: {
  receipt: Receipt | undefined;
  filePath: string;
  snapshot: FileSnapshot;
  desiredBytes?: Uint8Array;
}): PreviousFileValue => {
  const file = previousReceiptFile(input.receipt, input.filePath);
  const isNewFile = file == null;
  if (isNewFile) {
    return previousFileValue(input.snapshot);
  }

  const ownership = file.ownership;
  const isOwnershipIncompatible = ownership._tag !== "wholeFile";
  if (isOwnershipIncompatible) {
    throw createInstallError(`Receipted whole-file file ${input.filePath} has incompatible ownership.`);
  }

  const snapshot = input.snapshot;
  const installedContent = snapshot._tag === "file" && hashBytes(snapshot.bytes) === ownership.installedHash;
  const desiredContent =
    snapshot._tag === "file" && input.desiredBytes != null && bytesEqual(snapshot.bytes, input.desiredBytes);
  const isChangedAfterInstall = !installedContent && !desiredContent;
  if (isChangedAfterInstall) {
    throw createInstallError(`Receipted whole-file file ${input.filePath} changed after installation.`);
  }

  return ownership.previous;
};
