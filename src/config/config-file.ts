import { readFile } from "node:fs/promises";

import { z } from "zod";

import { bytesEqual, hashBytes } from "../install/file-bytes.js";
import { findDuplicateJsonKey } from "../install/find-duplicate-json-key.js";
import type { PreviousFileValue } from "../install/ownership.js";
import type { WriteOperation } from "../install/plan.js";
import type { Scope } from "../install/receipt.js";
import { formatZodIssues } from "../zod-issues.js";
import { type Config, configSchema, defaultConfig } from "./config-schema.js";

export const managedConfigPath = ".claude/agent-setup/config.json";

const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const textEncoder = new TextEncoder();

export type ConfigFileSnapshot =
  | { readonly _tag: "missing" }
  | { readonly _tag: "present"; readonly bytes: Uint8Array; readonly config: Config };

export interface ManagedConfigPlan {
  readonly config: Config;
  readonly managedConfigWrite: WriteOperation;
}

export type ManagedConfigSelection =
  | { readonly _tag: "selected"; readonly config: Config }
  | { readonly _tag: "firstProjectInstall"; readonly globalConfig: ConfigFileSnapshot };

export interface ManagedConfigRequest {
  readonly scope: Scope;
  readonly selection: ManagedConfigSelection;
  readonly previousConfigFile: PreviousFileValue;
}

const parseFailure = (input: { readonly configPath: string; readonly issue: string; readonly cause?: unknown }) =>
  new Error(`Managed config at ${input.configPath} is not valid JSON: ${input.issue}. Fix or remove it, then retry.`, {
    cause: input.cause,
  });

const decodeUtf8Text = (bytes: Uint8Array, configPath: string): string => {
  try {
    return textDecoder.decode(bytes);
  } catch (error) {
    throw parseFailure({
      configPath,
      issue: `file bytes are not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
    });
  }
};

const parseJsonText = (text: string, configPath: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw parseFailure({ configPath, issue: error instanceof Error ? error.message : String(error), cause: error });
  }
};

// Lossless at every trust boundary: no replacement characters, no BOM normalization, no collapsed duplicate keys.
const decodeConfigFileBytes = (input: { readonly bytes: Uint8Array; readonly configPath: string }): Config => {
  const text = decodeUtf8Text(input.bytes, input.configPath);

  const isByteOrderMarkPresent = text.startsWith("﻿");
  if (isByteOrderMarkPresent) {
    throw parseFailure({
      configPath: input.configPath,
      issue: "file must not start with a UTF-8 byte-order mark",
    });
  }

  const json = parseJsonText(text, input.configPath);

  const duplicateKey = findDuplicateJsonKey(text);
  if (duplicateKey !== undefined) {
    throw parseFailure({
      configPath: input.configPath,
      issue: `duplicate JSON property ${JSON.stringify(duplicateKey)}`,
    });
  }

  const configCheck = configSchema.safeParse(json);
  const isConfigValid = configCheck.success;
  if (!isConfigValid) {
    throw new Error(
      `Managed config at ${input.configPath} is invalid: ${formatZodIssues(configCheck.error)}. Fix or remove it, then retry.`,
      { cause: configCheck.error },
    );
  }

  return configCheck.data;
};

const isMissingFile = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";

const readConfigBytes = async (configPath: string): Promise<Uint8Array | null> => {
  try {
    return await readFile(configPath);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw error;
  }
};

export const readConfigFile = async (configPath: string): Promise<ConfigFileSnapshot> => {
  const bytes = await readConfigBytes(configPath);

  const isThereNoConfigFile = bytes === null;
  if (isThereNoConfigFile) {
    return { _tag: "missing" };
  }

  const config = decodeConfigFileBytes({ bytes, configPath });
  return { _tag: "present", bytes, config };
};

const renderManagedConfigBytes = (config: Config): Uint8Array =>
  textEncoder.encode(`${JSON.stringify(config, null, 2)}\n`);

// A present snapshot must decode from its own bytes to exactly the config it carries.
const addSnapshotMatchIssues = (snapshot: ConfigFileSnapshot, context: z.RefinementCtx) => {
  const isPresentSnapshot = snapshot._tag === "present";
  if (!isPresentSnapshot) {
    return;
  }

  const decodedConfig = decodeConfigFileBytes({ bytes: snapshot.bytes, configPath: "managed configuration snapshot" });
  const isDecodedConfigMatching = JSON.stringify(decodedConfig) === JSON.stringify(snapshot.config);
  if (!isDecodedConfigMatching) {
    context.addIssue({
      code: "custom",
      path: ["config"],
      message: "Decoded managed configuration must exactly match its source bytes.",
    });
  }
};

const configFileSnapshotSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("missing") }),
    z.strictObject({ _tag: z.literal("present"), bytes: z.instanceof(Uint8Array), config: configSchema }),
  ])
  .superRefine(addSnapshotMatchIssues);

const previousConfigFileSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("missing") }),
  z.strictObject({ _tag: z.literal("priorFile"), bytes: z.instanceof(Uint8Array) }),
]);

const addFirstProjectInstallIssues = (
  request: {
    readonly scope: Scope;
    readonly selection: { readonly _tag: string };
    readonly previousConfigFile: { readonly _tag: string };
  },
  context: z.RefinementCtx,
) => {
  const isFirstProjectInstall = request.selection._tag === "firstProjectInstall";
  if (!isFirstProjectInstall) {
    return;
  }

  const isProjectScope = request.scope === "project";
  if (!isProjectScope) {
    context.addIssue({
      code: "custom",
      path: ["selection", "_tag"],
      message: "A first project install requires project scope.",
    });
  }

  const isTargetMissing = request.previousConfigFile._tag === "missing";
  if (!isTargetMissing) {
    context.addIssue({
      code: "custom",
      path: ["previousConfigFile"],
      message: "A first project install requires a missing target managed config.",
    });
  }
};

const managedConfigRequestSchema = z
  .strictObject({
    scope: z.enum(["global", "project"]),
    selection: z.discriminatedUnion("_tag", [
      z.strictObject({ _tag: z.literal("selected"), config: configSchema }),
      z.strictObject({ _tag: z.literal("firstProjectInstall"), globalConfig: configFileSnapshotSchema }),
    ]),
    previousConfigFile: previousConfigFileSchema,
  })
  .superRefine(addFirstProjectInstallIssues);

const createManagedConfigWrite = (config: Config, previous: PreviousFileValue): WriteOperation => {
  const bytes = renderManagedConfigBytes(config);

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

const resolveSelectedConfig = (request: ManagedConfigRequest): Config => {
  switch (request.selection._tag) {
    case "selected":
      return request.selection.config;
    case "firstProjectInstall": {
      const globalSnapshot = request.selection.globalConfig;
      const isGlobalConfigPresent = globalSnapshot._tag === "present";
      if (!isGlobalConfigPresent) {
        return defaultConfig;
      }

      return globalSnapshot.config;
    }
  }
};

// Throws when a plan's bytes do not encode its config or its ownership hash does not match those bytes.
export const assertManagedConfigPlan = (plan: ManagedConfigPlan): void => {
  const bytes = renderManagedConfigBytes(plan.config);
  const write = plan.managedConfigWrite;
  const isBytesEncodingConfig = bytesEqual(write.bytes, bytes);
  if (!isBytesEncodingConfig) {
    throw new Error(
      "Cannot plan managed configuration: Managed-config bytes must encode the returned complete configuration.",
    );
  }

  const ownership = write.file.ownership;
  const isWholeFile = ownership._tag === "wholeFile";
  const isOwnershipHashMatching = !isWholeFile || ownership.installedHash === hashBytes(write.bytes);
  if (!isOwnershipHashMatching) {
    throw new Error(
      "Cannot plan managed configuration: Managed-config ownership hash must match its exact desired bytes.",
    );
  }
};

// Plans one managed config without I/O: validate the request, resolve one source, then check the planned write.
export const planManagedConfig = (input: unknown): ManagedConfigPlan => {
  const requestCheck = managedConfigRequestSchema.safeParse(input);
  const isRequestValid = requestCheck.success;
  if (!isRequestValid) {
    throw new Error(`Cannot plan managed configuration: ${formatZodIssues(requestCheck.error)}`, {
      cause: requestCheck.error,
    });
  }

  const request = requestCheck.data;
  const config = resolveSelectedConfig(request);
  const plan = {
    config,
    managedConfigWrite: createManagedConfigWrite(config, request.previousConfigFile),
  };
  assertManagedConfigPlan(plan);

  return plan;
};
