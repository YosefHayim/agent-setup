import { existsSync } from "node:fs";
import path from "node:path";

import { unfinishedClaudeJobStates } from "../../lib/claudeJobs.js";
import { liveClaudeSessionIds } from "../../lib/claudeLiveSessions.js";
import { codexHome } from "../../lib/codexHome.js";
import { folderEntries } from "../../lib/folderEntries.js";
import { realFolder } from "./folderPaths.js";
import { listOpenPaths } from "./runningProcesses.js";

export type LiveSessions = {
  readonly claudeSessionIds: ReadonlyArray<string>;
  readonly codexThreadIds: ReadonlyArray<string>;
  readonly jobFolders: ReadonlyArray<string>;
};

type ClaudeJob = { readonly sessionId: string; readonly folder: string };

const textAt = (jobState: Record<string, unknown>, property: string): string => {
  const candidate = jobState[property];
  return typeof candidate === "string" ? candidate : "";
};

const unfinishedClaudeJobs = (homeRoot: string): ReadonlyArray<ClaudeJob> =>
  unfinishedClaudeJobStates(homeRoot).map((jobState) => ({
    sessionId: textAt(jobState, "sessionId"),
    folder: textAt(jobState, "cwd"),
  }));

const codexLockFolder = (homeRoot: string): string => {
  const lockFolder = path.join(codexHome(homeRoot), "thread-writer-locks");
  return realFolder(lockFolder);
};

// A Codex writer holds an flock on thread-writer-locks/<id>.lock for as long as it can append. Listing open files
// looks at every process on the machine, so it runs only when there is a lock to check; without the list every lock
// counts as held.
const heldLockFiles = (lockFiles: ReadonlyArray<string>): ReadonlyArray<string> => {
  if (lockFiles.length === 0) {
    return [];
  }

  const openPaths = listOpenPaths();
  return lockFiles.filter((lockFile) => !openPaths || openPaths.includes(lockFile));
};

const heldCodexLockIds = (homeRoot: string): ReadonlyArray<string> => {
  const lockFolder = codexLockFolder(homeRoot);
  const lockFiles = folderEntries({ folder: lockFolder, recursive: false })
    .filter((name) => name.endsWith(".lock"))
    .map((name) => path.join(lockFolder, name));
  const heldFiles = heldLockFiles(lockFiles);
  return heldFiles.map((lockFile) => path.basename(lockFile, ".lock"));
};

// Codex leaves its lock files behind, so a waiting watcher looks only at its own session's lock, and lists open files
// only while that lock exists.
const isCodexLockHeld = (request: { readonly homeRoot: string; readonly threadId: string }): boolean => {
  const lockFolder = codexLockFolder(request.homeRoot);
  const lockFile = path.join(lockFolder, `${request.threadId}.lock`);
  const existingLockFiles = [lockFile].filter(existsSync);
  return heldLockFiles(existingLockFiles).length > 0;
};

// The ended session never counts: SessionEnd fires before its agent lets go, and a manual run names its own session.
// A folder that names live sessions but cannot be listed leaves them unknown.
export const liveSessions = (request: {
  readonly homeRoot: string;
  readonly endedSessionId: string;
}): LiveSessions | undefined => {
  const isOtherSession = (sessionId: string) => sessionId !== "" && sessionId !== request.endedSessionId;
  try {
    const jobs = unfinishedClaudeJobs(request.homeRoot);
    const runningClaudeSessionIds = [...liveClaudeSessionIds(request.homeRoot)];
    const jobSessionIds = jobs.map((job) => job.sessionId);
    const claudeSessionIds = new Set([...runningClaudeSessionIds, ...jobSessionIds].filter(isOtherSession));
    return {
      claudeSessionIds: [...claudeSessionIds],
      codexThreadIds: heldCodexLockIds(request.homeRoot).filter(isOtherSession),
      jobFolders: jobs.map((job) => job.folder).filter(Boolean),
    };
  } catch {
    return undefined;
  }
};

export const isSessionLive = (request: { readonly homeRoot: string; readonly sessionId: string }): boolean => {
  const isClaudeSessionLive = liveClaudeSessionIds(request.homeRoot).has(request.sessionId);
  return isClaudeSessionLive || isCodexLockHeld({ homeRoot: request.homeRoot, threadId: request.sessionId });
};
