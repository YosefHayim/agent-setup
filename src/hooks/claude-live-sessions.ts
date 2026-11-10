import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readClaudeConfigFolder } from "./environment.js";
import { listFolderNames } from "./folder-entries.js";
import { isPlainObject } from "./json-lines.js";
import { isProcessAlive } from "./process-alive.js";

// A second Claude account keeps its own config root beside ~/.claude, e.g. ~/.claude-work, with its own registry,
// while sharing the scratch root and often the projects folder.
export const listClaudeSettingsRoots = (homeRoot: string): ReadonlyArray<string> => {
  const accountRoots = readdirSync(homeRoot)
    .filter((name) => name === ".claude" || name.startsWith(".claude-"))
    .map((name) => path.join(homeRoot, name));
  const configuredRoot = readClaudeConfigFolder();
  const isThereConfiguredRoot = configuredRoot != null;

  return isThereConfiguredRoot ? [...new Set([configuredRoot, ...accountRoots])] : accountRoots;
};

// A config root that never ran a session has no registry.
const listRegistryFilesIn = (settingsRoot: string): ReadonlyArray<string> => {
  const registryFolder = path.join(settingsRoot, "sessions");
  return listFolderNames({ folder: registryFolder, recursive: false })
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(registryFolder, name));
};

type LiveSession = {
  readonly sessionId: string;
  readonly processId: number;
};

const listLiveSessionIn = (registryFile: string): ReadonlyArray<LiveSession> => {
  try {
    const registryLine: unknown = JSON.parse(readFileSync(registryFile, "utf8"));

    const registrySessionId = isPlainObject(registryLine) ? registryLine.sessionId : null;
    const isRegistryLineInvalid = !isPlainObject(registryLine) || typeof registrySessionId !== "string";
    if (isRegistryLineInvalid) {
      return [];
    }

    const processId = Number(registryLine.pid);
    return isProcessAlive(processId) ? [{ sessionId: registrySessionId, processId }] : [];
  } catch {
    // Claude Code removes its entry on exit, so one can vanish or be half-written while it is read.
    return [];
  }
};

// Claude Code writes <config root>/sessions/<pid>.json for every running process, naming the session it holds. A
// registry that cannot be listed throws, since any session could be running.
const listLiveSessions = (homeRoot: string): ReadonlyArray<LiveSession> => {
  const registryFiles = listClaudeSettingsRoots(homeRoot).flatMap(listRegistryFilesIn);
  return registryFiles.flatMap(listLiveSessionIn);
};

export const readLiveClaudeSessionIds = (homeRoot: string): ReadonlySet<string> => {
  const liveSessionIds = listLiveSessions(homeRoot).map((liveSession) => liveSession.sessionId);
  return new Set(liveSessionIds);
};

export const readLiveClaudeProcessIds = (homeRoot: string): ReadonlySet<number> => {
  const liveProcessIds = listLiveSessions(homeRoot).map((liveSession) => liveSession.processId);
  return new Set(liveProcessIds);
};
