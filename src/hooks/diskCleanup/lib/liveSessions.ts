import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { unfinishedClaudeJobStates } from "../../lib/claudeJobs.js";
import { claudeConfigRoots, liveClaudeSessionIds } from "../../lib/claudeLiveSessions.js";
import { codexHome } from "../../lib/codexHome.js";
import { listOpenPaths } from "./runningProcesses.js";

export type LiveSessions = {
  readonly sessionIds: ReadonlySet<string>;
  readonly claudeTranscripts: ReadonlyArray<string>;
  readonly codexRollouts: ReadonlyArray<string>;
  readonly jobFolders: ReadonlyArray<string>;
};

type ClaudeJob = { readonly sessionId: string; readonly folder: string };

const childNames = (folder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
};

const textAt = (jobState: Record<string, unknown>, property: string): string => {
  const candidate = jobState[property];
  return typeof candidate === "string" ? candidate : "";
};

const unfinishedClaudeJobs = (homeRoot: string): ReadonlyArray<ClaudeJob> =>
  unfinishedClaudeJobStates(homeRoot).map((jobState) => ({
    sessionId: textAt(jobState, "sessionId"),
    folder: textAt(jobState, "cwd"),
  }));

const claudeProjectFolders = (homeRoot: string): ReadonlyArray<string> =>
  claudeConfigRoots(homeRoot).flatMap((configRoot) => {
    const projectsFolder = path.join(configRoot, "projects");
    return childNames(projectsFolder).map((projectName) => path.join(projectsFolder, projectName));
  });

// A session's own transcript is <project>/<id>.jsonl, and each of its subagents writes
// <project>/<id>/subagents/<agent>.jsonl.
const claudeTranscriptsIn = (request: { readonly projectFolder: string; readonly sessionId: string }) => {
  const ownTranscript = path.join(request.projectFolder, `${request.sessionId}.jsonl`);
  const subagentsFolder = path.join(request.projectFolder, request.sessionId, "subagents");
  const subagentTranscripts = childNames(subagentsFolder)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(subagentsFolder, name));
  return [ownTranscript, ...subagentTranscripts].filter(existsSync);
};

const claudeTranscriptsOf = (request: { readonly homeRoot: string; readonly sessionIds: ReadonlySet<string> }) => {
  const projectFolders = claudeProjectFolders(request.homeRoot);
  return [...request.sessionIds].flatMap((sessionId) =>
    projectFolders.flatMap((projectFolder) => claudeTranscriptsIn({ projectFolder, sessionId })),
  );
};

// lsof names each open file by its real path, whatever symlink led to it.
const realFolder = (folder: string): string => {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
};

// A Codex writer holds an flock on thread-writer-locks/<id>.lock for as long as it can append; without a list of open
// files every lock counts as held.
const heldCodexLockIds = (homeRoot: string): ReadonlyArray<string> => {
  const lockFolder = realFolder(path.join(codexHome(homeRoot), "thread-writer-locks"));
  const lockFiles = childNames(lockFolder)
    .filter((name) => name.endsWith(".lock"))
    .map((name) => path.join(lockFolder, name));
  if (lockFiles.length === 0) {
    return [];
  }

  const openPaths = listOpenPaths();
  const heldLockFiles = lockFiles.filter((lockFile) => !openPaths || openPaths.includes(lockFile));
  return heldLockFiles.map((lockFile) => path.basename(lockFile, ".lock"));
};

const rolloutNamesIn = (sessionsFolder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(sessionsFolder, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
};

// Rollouts are sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl.
const codexRolloutsOf = (request: { readonly homeRoot: string; readonly threadIds: ReadonlyArray<string> }) => {
  if (request.threadIds.length === 0) {
    return [];
  }

  const sessionsFolder = path.join(codexHome(request.homeRoot), "sessions");
  return rolloutNamesIn(sessionsFolder)
    .filter((name) => name.endsWith(".jsonl") && request.threadIds.some((threadId) => name.includes(threadId)))
    .map((name) => path.join(sessionsFolder, name));
};

// The ended session never counts: SessionEnd fires before its agent lets go, and a manual run names its own session.
export const liveSessions = (request: { readonly homeRoot: string; readonly endedSessionId: string }): LiveSessions => {
  const isOtherSession = (sessionId: string) => sessionId !== "" && sessionId !== request.endedSessionId;
  const jobs = unfinishedClaudeJobs(request.homeRoot);
  const runningClaudeSessionIds = [...liveClaudeSessionIds(request.homeRoot)];
  const jobSessionIds = jobs.map((job) => job.sessionId);
  const claudeSessionIds = new Set([...runningClaudeSessionIds, ...jobSessionIds].filter(isOtherSession));
  const codexThreadIds = heldCodexLockIds(request.homeRoot).filter(isOtherSession);
  const claudeTranscripts = claudeTranscriptsOf({ homeRoot: request.homeRoot, sessionIds: claudeSessionIds });
  return {
    sessionIds: new Set([...claudeSessionIds, ...codexThreadIds]),
    claudeTranscripts: [...new Set(claudeTranscripts)],
    codexRollouts: codexRolloutsOf({ homeRoot: request.homeRoot, threadIds: codexThreadIds }),
    jobFolders: jobs.map((job) => job.folder).filter(Boolean),
  };
};

export const isSessionLive = (request: { readonly homeRoot: string; readonly sessionId: string }): boolean => {
  const isClaudeSessionLive = liveClaudeSessionIds(request.homeRoot).has(request.sessionId);
  return isClaudeSessionLive || heldCodexLockIds(request.homeRoot).includes(request.sessionId);
};
