/** Plan the final unowned bytes of receipted files: what uninstall and update write back or remove. */

import { join } from "node:path";

import { z } from "zod";

import { agentCatalog } from "#src/catalog/agent-catalog.js";
import { planInstructionFile } from "./agent-formats/instruction-file.js";
import { planInstructionLink } from "./agent-formats/instruction-link.js";
import { hashBytes } from "./file-bytes.js";
import { restoreSettings } from "./hook-settings.js";
import { checkFileChange, expectedCurrent, type FileSnapshot, readFileSnapshot } from "./host-files.js";
import { hooksPath } from "./install-paths.js";
import { createInstallError, wrapAsInstallError } from "./install-request.js";
import { type OwnedFile, ownedFileSchema } from "./ownership.js";
import { absoluteRootSchema, type FileChange } from "./plan.js";
import type { Receipt } from "./receipt.js";

interface RestoreTarget {
  readonly file: OwnedFile;
  readonly snapshot: FileSnapshot;
}

const restoreWholeFile = ({ file, snapshot }: RestoreTarget): FileChange => {
  const ownership = file.ownership;
  const isFormatSpecific = ownership._tag !== "wholeFile";
  if (isFormatSpecific) {
    throw createInstallError(`File ${file.path} requires a format-specific restoration.`);
  }

  // We created this path from nothing, so uninstall must not stick on drift, upgrades, or prior deletion;
  // expectedCurrent still binds the transaction to the bytes observed at plan time.
  const previous = ownership.previous;
  const isNewFile = previous._tag === "missing";
  if (isNewFile) {
    return checkFileChange({
      _tag: "remove",
      file,
      unownedBytes: new Uint8Array(),
      expectedCurrent: expectedCurrent(snapshot),
    });
  }

  const isFileMissingOrUnchanged = snapshot._tag === "missing" || hashBytes(snapshot.bytes) === ownership.installedHash;
  if (isFileMissingOrUnchanged) {
    return checkFileChange({
      _tag: "restore",
      file,
      bytes: previous.bytes,
      expectedCurrent: expectedCurrent(snapshot),
    });
  }

  throw createInstallError(`Receipted file ${file.path} changed after installation.`);
};

const checkFormatRestoration = (
  { file, snapshot, format }: RestoreTarget & { readonly format: string },
  operation: { readonly _tag: string },
): FileChange => {
  const isOperationNone = operation._tag === "none";
  if (isOperationNone) {
    throw createInstallError(`${format} restoration for ${file.path} returned no operation.`);
  }

  return checkFileChange({ ...operation, expectedCurrent: expectedCurrent(snapshot) });
};

const restoreInstructionFile = (target: RestoreTarget): FileChange => {
  const instructionOperation = planInstructionFile({
    path: target.file.path,
    desired: { _tag: "absent" },
    currentFile: target.snapshot,
    previousFile: { _tag: "owned", file: target.file },
  });

  return checkFormatRestoration({ ...target, format: "Instruction" }, instructionOperation);
};

const restoreInstructionLink = (target: RestoreTarget): FileChange => {
  const { file } = target;
  const owner = file.owner;
  const isNotSingleAgentOwner = owner._tag !== "agent" || owner.agentIds.length !== 1;
  if (isNotSingleAgentOwner) {
    throw createInstallError(`Native config restoration for ${file.path} requires one agent owner.`);
  }

  const agentId = owner.agentIds.at(0);
  const agent = agentCatalog.find((candidate) => candidate.id === agentId);
  const isCatalogAgentMissing = agent == null || agent.target._tag !== "instructionLink";
  if (isCatalogAgentMissing) {
    throw createInstallError(`Native config restoration for ${file.path} has no catalog agent.`);
  }

  const linkOperation = planInstructionLink({
    agent,
    desired: { _tag: "absent" },
    currentFile: target.snapshot,
    previousFile: { _tag: "owned", file },
  });

  return checkFormatRestoration({ ...target, format: "Native config" }, linkOperation);
};

const restoreRequestSchema = z
  .strictObject({
    root: absoluteRootSchema.describe("Canonical installation root containing the receipted files."),
    files: z.array(ownedFileSchema).describe("Exact receipt entries whose final unowned state must be computed."),
  })
  .describe("Receipt-authorized file restoration request with no detection authority.");

const planFileRestoration = async ({ root, file }: { root: string; file: OwnedFile }): Promise<FileChange> => {
  const snapshot = await readFileSnapshot(join(root, file.path));
  const target: RestoreTarget = { file, snapshot };

  switch (file.kind._tag) {
    case "instruction":
      return restoreInstructionFile(target);
    case "instructionLink":
      return restoreInstructionLink(target);
    case "settings":
      return restoreSettings({ ...target, installedHooksFolder: join(root, hooksPath) });
    case "runtime":
    case "skill":
    case "rule":
    case "managedConfig":
    case "receipt":
      return restoreWholeFile(target);
  }
};

// Computes each receipted file's final unowned bytes without touching the filesystem.
export const planRestorations = async (input: unknown): Promise<FileChange[]> => {
  try {
    const request = restoreRequestSchema.parse(input);
    const restorations: FileChange[] = [];
    for (const file of request.files) {
      restorations.push(await planFileRestoration({ root: request.root, file }));
    }

    return restorations;
  } catch (error) {
    throw wrapAsInstallError(error);
  }
};

export const planStaleRestorations = async (input: {
  root: string;
  previousReceipt: Receipt | undefined;
  desiredWrites: ReadonlyArray<FileChange>;
  settingsPlans: ReadonlyArray<FileChange>;
}): Promise<FileChange[]> => {
  const previousReceipt = input.previousReceipt;
  const isThereNoPreviousReceipt = previousReceipt == null;
  if (isThereNoPreviousReceipt) {
    return [];
  }

  const desiredPaths = new Set(input.desiredWrites.map((write) => write.file.path));
  const settingsRestorations = input.settingsPlans.filter((operation) => operation._tag !== "write");
  const settingsPaths = new Set(settingsRestorations.map((operation) => operation.file.path));
  const staleFiles = previousReceipt.ownedFiles.filter(
    (file) => !desiredPaths.has(file.path) && !settingsPaths.has(file.path),
  );
  const staleFileRestorations = await planRestorations({ root: input.root, files: staleFiles });

  return [...settingsRestorations, ...staleFileRestorations];
};
