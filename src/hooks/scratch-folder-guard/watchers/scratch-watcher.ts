#!/usr/bin/env node

import { writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasRunningSubagents } from "../../claude-subagents.js";
import { readFailureText } from "../../failure-text.js";
import { readSettings } from "../../hook-config.js";
import { removeAbandonedScratch } from "../abandoned-scratch.js";
import { removeScratchFolders } from "../scratch-removal.js";
import { listClaudeSessionFolders } from "../session-scratch.js";

// A session restarted while its subagents run can pick them up again on resume, and they need the clones, logs and
// build output they left. A subagent folder that cannot be read could hold one of them.
const hasLeftSubagentsRunning = (request: { readonly homeRoot: string; readonly sessionId: string }): boolean => {
  try {
    return hasRunningSubagents(request);
  } catch {
    return true;
  }
};

// A Codex thread can be picked up again after its SessionEnd, so only a Claude Code session loses its folder here. A
// folder kept for its subagents goes once nothing in it changed for a day.
const removeEndedSessionScratch = (request: { readonly homeRoot: string; readonly sessionId: string }): void => {
  if (hasLeftSubagentsRunning(request)) {
    return;
  }

  const endedSessionFolders = listClaudeSessionFolders(request.homeRoot).filter(
    (folder) => path.basename(folder) === request.sessionId,
  );
  removeScratchFolders(endedSessionFolders);
};

const runWatcher = (): void => {
  const homeRoot = os.homedir();

  const endedSessionId = process.argv[2];
  const hasEndedSessionId = endedSessionId != null && endedSessionId !== "";
  if (hasEndedSessionId) {
    removeEndedSessionScratch({ homeRoot, sessionId: endedSessionId });
  }

  removeAbandonedScratch(homeRoot);
};

try {
  runWatcher();
} catch (failure) {
  const isDebugLogging = readSettings().debugLogs;
  if (isDebugLogging) {
    writeSync(2, `scratch-folder-guard error: ${readFailureText(failure)}\n`);
  }

  process.exit(0);
}
