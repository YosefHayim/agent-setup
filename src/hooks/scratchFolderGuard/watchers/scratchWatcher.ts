#!/usr/bin/env node
// Detached watcher behind the SessionEnd hook, and the command for a manual pass:
//   node scratchWatcher.js [<ended-session-id>]
// Fails open: a crash leaves every scratch folder where it was.

import { writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { hasRunningSubagents } from "../../lib/claudeSubagents.js";
import { readConfig } from "../../lib/hookConfig.js";
import { removeAbandonedScratch } from "../lib/abandonedScratch.js";
import { removeScratchFolders } from "../lib/scratchRemoval.js";
import { claudeSessionFolders } from "../lib/sessionScratch.js";

// A session restarted while its subagents run can pick them up again on resume, and they need the clones, logs and
// build output they left. A subagent folder that cannot be read could hold one of them.
const leftSubagentsRunning = (request: { readonly homeRoot: string; readonly sessionId: string }): boolean => {
  try {
    return hasRunningSubagents(request);
  } catch {
    return true;
  }
};

// A Codex thread can be picked up again after its SessionEnd, so only a Claude Code session loses its folder here. A
// folder kept for its subagents goes once nothing in it changed for a day.
const removeEndedSessionScratch = (request: { readonly homeRoot: string; readonly sessionId: string }): void => {
  if (leftSubagentsRunning(request)) {
    return;
  }

  const endedSessionFolders = claudeSessionFolders(request.homeRoot).filter(
    (folder) => path.basename(folder) === request.sessionId,
  );
  removeScratchFolders(endedSessionFolders);
};

const runWatcher = (): void => {
  const homeRoot = process.env.HOME || os.homedir();
  const endedSessionId = process.argv[2];
  if (endedSessionId) {
    removeEndedSessionScratch({ homeRoot, sessionId: endedSessionId });
  }
  removeAbandonedScratch(homeRoot);
};

try {
  runWatcher();
} catch (failure) {
  if (readConfig().debugLogs) {
    writeSync(2, `scratch-folder-guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
