// Dependency-free config reader for installed hooks. `src/config/configSchema.ts` owns the contract;
// the colocated test keeps these defaults aligned with it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HookConfig = {
  readonly sessionRehomeRoots: ReadonlyArray<string>;
  readonly diskCleanupRoots: ReadonlyArray<string>;
  readonly debugLogs: boolean;
};

const CODE_ROOT_FOLDERS = ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"];

const DEFAULTS: HookConfig = {
  sessionRehomeRoots: CODE_ROOT_FOLDERS,
  diskCleanupRoots: CODE_ROOT_FOLDERS,
  debugLogs: false,
};

// Installed hooks load this module as <installRoot>/hooks/<feature>/lib/hookConfig.js, because install copies
// src/hooks/lib into each feature's lib/. config.json and hook state live under <installRoot>.
export const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const managedConfigPath = path.join(installRoot, "config.json");

const propertyOf = (candidate: object, key: keyof HookConfig): unknown =>
  Object.getOwnPropertyDescriptor(candidate, key)?.value;

// A hand-edited " Projects " means Projects, and a blank root would resolve to the home folder itself and scan every
// folder in it.
const rootFoldersSetting = (candidate: object, key: "sessionRehomeRoots" | "diskCleanupRoots") => {
  const rootFolders = propertyOf(candidate, key);
  if (!Array.isArray(rootFolders)) {
    return DEFAULTS[key];
  }

  return rootFolders
    .filter((folder): folder is string => typeof folder === "string")
    .map((folder) => folder.trim())
    .filter((folder) => folder !== "");
};

// A missing or malformed field keeps the application default.
export const decodeHookConfig = (candidate: unknown): HookConfig => {
  if (typeof candidate !== "object" || candidate === null) return DEFAULTS;

  const debugLogs = propertyOf(candidate, "debugLogs");
  return {
    sessionRehomeRoots: rootFoldersSetting(candidate, "sessionRehomeRoots"),
    diskCleanupRoots: rootFoldersSetting(candidate, "diskCleanupRoots"),
    debugLogs: typeof debugLogs === "boolean" ? debugLogs : DEFAULTS.debugLogs,
  };
};

// Read on every call, so a running watcher follows `agent-setup config set`.
export const readConfig = (): HookConfig => {
  try {
    return decodeHookConfig(JSON.parse(readFileSync(managedConfigPath, "utf8")));
  } catch {
    return DEFAULTS;
  }
};
