import { existsSync } from "node:fs";
import path from "node:path";

import { listUnfinishedClaudeJobStatuses } from "../claude-jobs.js";
import { readLiveClaudeSessionIds } from "../claude-live-sessions.js";
import { readCodexHome } from "../codex-home.js";
import { listFolderNames } from "../folder-entries.js";
import { readRealFolder } from "./folder-paths.js";
import { listOpenPaths } from "./running-processes.js";

export type LiveSessions = {
  readonly claudeSessionIds: ReadonlyArray<string>;
  readonly codexThreadIds: ReadonlyArray<string>;
  readonly jobFolders: ReadonlyArray<string>;
};

type ClaudeJob = { readonly sessionId: string; readonly folder: string };

const readStringAt = (jobStatus: Record<string, unknown>, property: string): string => {
  const candidate = jobStatus[property];

  const isCandidateString = typeof candidate === "string";
  return isCandidateString ? candidate : "";
};

const listUnfinishedClaudeJobs = (homeRoot: string): ReadonlyArray<ClaudeJob> =>
  listUnfinishedClaudeJobStatuses(homeRoot).map((jobStatus) => ({
    sessionId: readStringAt(jobStatus, "sessionId"),
    folder: readStringAt(jobStatus, "cwd"),
  }));

const readCodexLockFolder = (homeRoot: string): string => {
  const lockFolder = path.join(readCodexHome(homeRoot), "thread-writer-locks");
  return readRealFolder(lockFolder);
};

// A Codex writer holds an flock on thread-writer-locks/<id>.lock for as long as it can append. Listing open files
// looks at every process on the machine, so it runs only when there is a lock to check; without the list every lock
// counts as held.
const listHeldLockFiles = (lockFiles: ReadonlyArray<string>): ReadonlyArray<string> => {
  const isLockFilesEmpty = lockFiles.length === 0;
  if (isLockFilesEmpty) {
    return [];
  }

  const openPaths = listOpenPaths();
  return lockFiles.filter((lockFile) => !openPaths || openPaths.includes(lockFile));
};

const listHeldCodexLockIds = (homeRoot: string): ReadonlyArray<string> => {
  const lockFolder = readCodexLockFolder(homeRoot);
  const lockFiles = listFolderNames({ folder: lockFolder, recursive: false })
    .filter((name) => name.endsWith(".lock"))
    .map((name) => path.join(lockFolder, name));
  const heldFiles = listHeldLockFiles(lockFiles);
  return heldFiles.map((lockFile) => path.basename(lockFile, ".lock"));
};

// Codex leaves its lock files behind, so a waiting watcher looks only at its own session's lock, and lists open files
// only while that lock exists.
const isCodexLockHeld = (request: { readonly homeRoot: string; readonly threadId: string }): boolean => {
  const lockFolder = readCodexLockFolder(request.homeRoot);
  const lockFile = path.join(lockFolder, `${request.threadId}.lock`);
  const existingLockFiles = [lockFile].filter(existsSync);
  return listHeldLockFiles(existingLockFiles).length > 0;
};

// The ended session never counts: SessionEnd fires before its agent lets go, and a manual run names its own session.
// A folder that names live sessions but cannot be listed leaves them unknown.
export const readLiveSessions = (request: {
  readonly homeRoot: string;
  readonly endedSessionId: string;
}): LiveSessions | undefined => {
  const isOtherSession = (sessionId: string) => sessionId !== "" && sessionId !== request.endedSessionId;
  try {
    const jobs = listUnfinishedClaudeJobs(request.homeRoot);
    const runningClaudeSessionIds = [...readLiveClaudeSessionIds(request.homeRoot)];
    const jobSessionIds = jobs.map((job) => job.sessionId);
    const claudeSessionIds = new Set([...runningClaudeSessionIds, ...jobSessionIds].filter(isOtherSession));
    return {
      claudeSessionIds: [...claudeSessionIds],
      codexThreadIds: listHeldCodexLockIds(request.homeRoot).filter(isOtherSession),
      jobFolders: jobs.map((job) => job.folder).filter(Boolean),
    };
  } catch {
    return undefined;
  }
};

export const isSessionLive = (request: { readonly homeRoot: string; readonly sessionId: string }): boolean => {
  const isClaudeSessionLive = readLiveClaudeSessionIds(request.homeRoot).has(request.sessionId);
  return isClaudeSessionLive || isCodexLockHeld({ homeRoot: request.homeRoot, threadId: request.sessionId });
};
