import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { isNotFound } from "#src/install/file-bytes.js";
import { type InstallationDestination, receiptPath } from "#src/install/install-paths.js";
import { preparePackage } from "#src/install/prepare-package.js";
import { readReceipt, type Scope } from "#src/install/receipt.js";
import { update } from "#src/install/update.js";
import { managedConfigPath, planManagedConfig, readConfigFile } from "./config-file.js";
import { type Config, defaultConfig } from "./config-schema.js";
import { type HostScan, readDestinationForScope, scanHost } from "./host-scan.js";

type SettingsTarget = {
  readonly scope: Scope;
  readonly host: HostScan;
  readonly destination: InstallationDestination;
  readonly configPath: string;
};

type SettingsWrite = { readonly _tag: "selected"; readonly config: Config } | { readonly _tag: "reset" };

type PreviousSettingsFile = { readonly _tag: "priorFile"; readonly bytes: Uint8Array } | { readonly _tag: "missing" };

// Locates a scope's config.json without reading it, so a full reset still works when the file is unreadable.
export const readLocateSettingsTarget = async (scope: Scope): Promise<SettingsTarget> => {
  const host = await scanHost();
  const destination = readDestinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });

  return {
    scope,
    host,
    destination,
    configPath: path.join(destination.root, managedConfigPath),
  };
};

// Hooks under `root` read its own config.json, else the global one that a first project install copies.
export const readSettingsAt = async (request: {
  readonly root: string;
  readonly homeRoot: string;
}): Promise<Config> => {
  const ownSettings = await readConfigFile(path.join(request.root, managedConfigPath));

  const isOwnSettingsPresent = ownSettings._tag === "present";
  if (isOwnSettingsPresent) {
    return ownSettings.config;
  }

  const isRootHomeRoot = path.resolve(request.root) === path.resolve(request.homeRoot);
  if (isRootHomeRoot) {
    return defaultConfig;
  }

  const globalSettings = await readConfigFile(path.join(request.homeRoot, managedConfigPath));

  const isGlobalSettingsPresent = globalSettings._tag === "present";
  if (isGlobalSettingsPresent) {
    return globalSettings.config;
  }

  return defaultConfig;
};

export const readSettings = async (scope: Scope): Promise<SettingsTarget & { readonly config: Config }> => {
  const target = await readLocateSettingsTarget(scope);
  const settingsAtTarget = await readSettingsAt({ root: target.destination.root, homeRoot: target.host.homeRoot });

  return { ...target, config: settingsAtTarget };
};

const readPreviousSettingsFile = async (settingsPath: string): Promise<PreviousSettingsFile> => {
  try {
    const bytes = await readFile(settingsPath);

    return { _tag: "priorFile", bytes: new Uint8Array(bytes) };
  } catch (error) {
    const isSettingsFileMissing = isNotFound(error);
    if (isSettingsFileMissing) {
      return { _tag: "missing" };
    }

    throw error;
  }
};

// An installed scope saves through `update` so the receipt keeps owning config.json; otherwise write the file directly.
export const saveSettings = async (
  request: { readonly target: SettingsTarget; readonly configuration: SettingsWrite },
  signal: AbortSignal,
): Promise<"receipt" | "file"> => {
  const { target, configuration } = request;
  const receiptSnapshot = await readReceipt(path.join(target.destination.root, receiptPath));
  const isReceiptPresent = receiptSnapshot._tag === "present";

  const isReceiptScopeMismatched = isReceiptPresent && receiptSnapshot.receipt.scope !== target.scope;
  if (isReceiptScopeMismatched) {
    throw new Error(
      `Receipt scope is ${receiptSnapshot.receipt.scope}, not ${target.scope}; select the matching scope.`,
    );
  }

  if (isReceiptPresent) {
    const preparedPackage = await preparePackage();
    await update(
      {
        destination: target.destination,
        host: { homeRoot: target.host.homeRoot },
        preparedPackage,
        features: { _tag: "preserve" },
        agents: { _tag: "detected", evidence: target.host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration,
      },
      signal,
    );
    return "receipt";
  }

  // The plan keeps the old bytes only as its restoration value and never decodes them, so a broken file is replaceable.
  const previousSettingsFile = await readPreviousSettingsFile(target.configPath);
  const isResetWrite = configuration._tag === "reset";
  const settingsToWrite = isResetWrite ? defaultConfig : configuration.config;
  const managedSettingsPlan = planManagedConfig({
    scope: target.scope,
    selection: { _tag: "selected", config: settingsToWrite },
    previousConfigFile: previousSettingsFile,
  });

  await mkdir(path.dirname(target.configPath), { recursive: true });
  await writeFile(target.configPath, managedSettingsPlan.managedConfigWrite.bytes);
  return "file";
};
