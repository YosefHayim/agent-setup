import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HookSettings = {
  readonly sessionRehomeRoots: ReadonlyArray<string>;
  readonly diskCleanupRoots: ReadonlyArray<string>;
  readonly debugLogs: boolean;
};

const CODE_ROOT_FOLDERS = ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"];

const DEFAULTS: HookSettings = {
  sessionRehomeRoots: CODE_ROOT_FOLDERS,
  diskCleanupRoots: CODE_ROOT_FOLDERS,
  debugLogs: false,
};

// Installed hooks load this module as <installRoot>/hooks/<feature>/lib/hook-config.js, because install copies
// the shared files in src/hooks into each feature's lib/. config.json and hook state live under <installRoot>.
export const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const managedSettingsPath = path.join(installRoot, "config.json");

const readPropertyOf = (candidate: object, key: keyof HookSettings): unknown =>
  Object.getOwnPropertyDescriptor(candidate, key)?.value;

// A hand-edited " Projects " means Projects, and a blank root would resolve to the home folder itself and scan every
// folder in it.
const listRootFoldersSetting = (candidate: object, key: "sessionRehomeRoots" | "diskCleanupRoots") => {
  const rootFolders = readPropertyOf(candidate, key);

  const isRootFoldersInvalid = !Array.isArray(rootFolders);
  if (isRootFoldersInvalid) {
    return DEFAULTS[key];
  }

  return rootFolders
    .filter((folder): folder is string => typeof folder === "string")
    .map((folder) => folder.trim())
    .filter((folder) => folder !== "");
};

// A missing or malformed field keeps the application default.
export const decodeHookSettings = (candidate: unknown): HookSettings => {
  const isNotObjectCandidate = typeof candidate !== "object" || candidate === null;
  if (isNotObjectCandidate) return DEFAULTS;

  const debugLogs = readPropertyOf(candidate, "debugLogs");
  const isDebugLogsBoolean = typeof debugLogs === "boolean";

  return {
    sessionRehomeRoots: listRootFoldersSetting(candidate, "sessionRehomeRoots"),
    diskCleanupRoots: listRootFoldersSetting(candidate, "diskCleanupRoots"),
    debugLogs: isDebugLogsBoolean ? debugLogs : DEFAULTS.debugLogs,
  };
};

// Read on every call, so a running watcher follows `agent-setup config set`.
export const readSettings = (): HookSettings => {
  try {
    return decodeHookSettings(JSON.parse(readFileSync(managedSettingsPath, "utf8")));
  } catch {
    return DEFAULTS;
  }
};
