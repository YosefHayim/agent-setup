import { readFile } from "node:fs/promises";

import { z } from "zod";

import { bytesEqual, hashBytes } from "#src/install/file-bytes.js";
import { findDuplicateJsonKey } from "#src/install/find-duplicate-json-key.js";
import type { PreviousFileValue } from "#src/install/ownership.js";
import type { WriteOperation } from "#src/install/plan.js";
import type { Scope } from "#src/install/receipt.js";
import { joinZodIssueMessages } from "#src/zod-issue-messages.js";
import { type Config, defaultConfig, settingsSchema } from "./config-schema.js";

export const managedConfigPath = ".claude/agent-setup/config.json";

const stringDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const stringEncoder = new TextEncoder();

export type ConfigFileSnapshot =
  | { readonly _tag: "missing" }
  | { readonly _tag: "present"; readonly bytes: Uint8Array; readonly config: Config };

export interface ManagedConfigPlan {
  readonly config: Config;
  readonly managedConfigWrite: WriteOperation;
}

type ManagedSettingsSelection =
  | { readonly _tag: "selected"; readonly config: Config }
  | { readonly _tag: "firstProjectInstall"; readonly globalConfig: ConfigFileSnapshot };

export interface ManagedConfigRequest {
  readonly scope: Scope;
  readonly selection: ManagedSettingsSelection;
  readonly previousConfigFile: PreviousFileValue;
}

const parseFailure = (details: { readonly configPath: string; readonly issue: string; readonly cause?: unknown }) =>
  new Error(
    `Managed config at ${details.configPath} is not valid JSON: ${details.issue}. Fix or remove it, then retry.`,
    {
      cause: details.cause,
    },
  );

const decodeUtf8String = (bytes: Uint8Array, settingsPath: string): string => {
  try {
    return stringDecoder.decode(bytes);
  } catch (error) {
    const isErrorInstance = error instanceof Error;
    const issue = isErrorInstance ? error.message : String(error);
    throw parseFailure({
      configPath: settingsPath,
      issue: `file bytes are not valid UTF-8: ${issue}`,
      cause: error,
    });
  }
};

const parseDocumentString = (decodedSettingsFile: string, settingsPath: string): unknown => {
  try {
    return JSON.parse(decodedSettingsFile);
  } catch (error) {
    const isErrorInstance = error instanceof Error;
    const issue = isErrorInstance ? error.message : String(error);
    throw parseFailure({ configPath: settingsPath, issue, cause: error });
  }
};

// Lossless at every trust boundary: no replacement characters, no BOM normalization, no collapsed duplicate keys.
const decodeSettingsFileBytes = (details: { readonly bytes: Uint8Array; readonly configPath: string }): Config => {
  const decodedSettingsFile = decodeUtf8String(details.bytes, details.configPath);

  const isByteOrderMarkPresent = decodedSettingsFile.startsWith("﻿");
  if (isByteOrderMarkPresent) {
    throw parseFailure({
      configPath: details.configPath,
      issue: "file must not start with a UTF-8 byte-order mark",
    });
  }

  const document = parseDocumentString(decodedSettingsFile, details.configPath);

  const duplicateKey = findDuplicateJsonKey(decodedSettingsFile);

  const hasDuplicateKey = duplicateKey != null;
  if (hasDuplicateKey) {
    throw parseFailure({
      configPath: details.configPath,
      issue: `duplicate JSON property ${JSON.stringify(duplicateKey)}`,
    });
  }

  const settingsCheck = settingsSchema.safeParse(document);

  const isSettingsInvalid = !settingsCheck.success;
  if (isSettingsInvalid) {
    throw new Error(
      `Managed config at ${details.configPath} is invalid: ${joinZodIssueMessages(settingsCheck.error)}. Fix or remove it, then retry.`,
      { cause: settingsCheck.error },
    );
  }

  return settingsCheck.data;
};

const isMissingFile = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";

const readSettingsBytes = async (settingsPath: string): Promise<Uint8Array | null> => {
  try {
    return await readFile(settingsPath);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw error;
  }
};

export const readConfigFile = async (settingsPath: string): Promise<ConfigFileSnapshot> => {
  const bytes = await readSettingsBytes(settingsPath);

  const isThereNoSettingsFile = bytes === null;
  if (isThereNoSettingsFile) {
    return { _tag: "missing" };
  }

  const settings = decodeSettingsFileBytes({ bytes, configPath: settingsPath });
  return { _tag: "present", bytes, config: settings };
};

const encodeManagedSettingsBytes = (settings: Config): Uint8Array =>
  stringEncoder.encode(`${JSON.stringify(settings, null, 2)}\n`);

// A present snapshot must decode from its own bytes to exactly the config it carries.
const addSnapshotMismatchIssues = (snapshot: ConfigFileSnapshot, refinement: z.RefinementCtx) => {
  const isSnapshotMissing = snapshot._tag === "missing";
  if (isSnapshotMissing) {
    return;
  }

  const decodedSettings = decodeSettingsFileBytes({
    bytes: snapshot.bytes,
    configPath: "managed configuration snapshot",
  });

  const isDecodedSettingsMismatched = JSON.stringify(decodedSettings) !== JSON.stringify(snapshot.config);
  if (isDecodedSettingsMismatched) {
    refinement.addIssue({
      code: "custom",
      path: ["config"],
      message: "Decoded managed configuration must exactly match its source bytes.",
    });
  }
};

const settingsFileSnapshotSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("missing") }),
    z.strictObject({ _tag: z.literal("present"), bytes: z.instanceof(Uint8Array), config: settingsSchema }),
  ])
  .superRefine(addSnapshotMismatchIssues);

const previousSettingsFileSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("missing") }),
  z.strictObject({ _tag: z.literal("priorFile"), bytes: z.instanceof(Uint8Array) }),
]);

const addFirstProjectInstallIssues = (
  request: {
    readonly scope: Scope;
    readonly selection: { readonly _tag: string };
    readonly previousConfigFile: { readonly _tag: string };
  },
  refinement: z.RefinementCtx,
) => {
  const isSelectionNotFirstProjectInstall = request.selection._tag !== "firstProjectInstall";
  if (isSelectionNotFirstProjectInstall) {
    return;
  }

  const isScopeNotProject = request.scope !== "project";
  if (isScopeNotProject) {
    refinement.addIssue({
      code: "custom",
      path: ["selection", "_tag"],
      message: "A first project install requires project scope.",
    });
  }

  const isTargetAlreadyPresent = request.previousConfigFile._tag !== "missing";
  if (isTargetAlreadyPresent) {
    refinement.addIssue({
      code: "custom",
      path: ["previousConfigFile"],
      message: "A first project install requires a missing target managed config.",
    });
  }
};

const managedSettingsRequestSchema = z
  .strictObject({
    scope: z.enum(["global", "project"]),
    selection: z.discriminatedUnion("_tag", [
      z.strictObject({ _tag: z.literal("selected"), config: settingsSchema }),
      z.strictObject({ _tag: z.literal("firstProjectInstall"), globalConfig: settingsFileSnapshotSchema }),
    ]),
    previousConfigFile: previousSettingsFileSchema,
  })
  .superRefine(addFirstProjectInstallIssues);

const createManagedSettingsWrite = (settings: Config, previous: PreviousFileValue): WriteOperation => {
  const bytes = encodeManagedSettingsBytes(settings);

  return {
    _tag: "write",
    file: {
      path: managedConfigPath,
      kind: { _tag: "managedConfig" },
      owner: { _tag: "application" },
      ownership: { _tag: "wholeFile", installedHash: hashBytes(bytes), previous },
    },
    bytes,
  };
};

const pickSelectedSettings = (request: ManagedConfigRequest): Config => {
  switch (request.selection._tag) {
    case "selected":
      return request.selection.config;
    case "firstProjectInstall": {
      const globalSnapshot = request.selection.globalConfig;

      const isGlobalSettingsMissing = globalSnapshot._tag === "missing";
      if (isGlobalSettingsMissing) {
        return defaultConfig;
      }

      return globalSnapshot.config;
    }
  }
};

// Throws when a plan's bytes do not encode its config or its ownership hash does not match those bytes.
export const assertManagedSettingsPlan = (plan: ManagedConfigPlan): void => {
  const bytes = encodeManagedSettingsBytes(plan.config);
  const write = plan.managedConfigWrite;

  const isBytesDrifted = !bytesEqual(write.bytes, bytes);
  if (isBytesDrifted) {
    throw new Error(
      "Cannot plan managed configuration: Managed-config bytes must encode the returned complete configuration.",
    );
  }

  const ownership = write.file.ownership;
  const isWholeFile = ownership._tag === "wholeFile";

  const isOwnershipHashMismatched = isWholeFile && ownership.installedHash !== hashBytes(write.bytes);
  if (isOwnershipHashMismatched) {
    throw new Error(
      "Cannot plan managed configuration: Managed-config ownership hash must match its exact desired bytes.",
    );
  }
};

// Plans one managed config without I/O: validate the request, resolve one source, then check the planned write.
export const planManagedConfig = (details: unknown): ManagedConfigPlan => {
  const requestCheck = managedSettingsRequestSchema.safeParse(details);

  const isRequestInvalid = !requestCheck.success;
  if (isRequestInvalid) {
    throw new Error(`Cannot plan managed configuration: ${joinZodIssueMessages(requestCheck.error)}`, {
      cause: requestCheck.error,
    });
  }

  const request = requestCheck.data;
  const settings = pickSelectedSettings(request);
  const plan = {
    config: settings,
    managedConfigWrite: createManagedSettingsWrite(settings, request.previousConfigFile),
  };
  assertManagedSettingsPlan(plan);

  return plan;
};
