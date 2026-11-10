#!/usr/bin/env node

import { readFileSync, writeSync } from "node:fs";
import os from "node:os";
import { readShellCommand } from "../../bash-hook-input.js";
import { readLiveClaudeProcessIds } from "../../claude-live-sessions.js";
import { readFailureText } from "../../failure-text.js";
import { readSettings } from "../../hook-config.js";
import { allowAndExit, printDecisionAndExit } from "../../hook-output.js";
import { listRunningProcesses } from "../../process-table.js";
import { decideKill } from "../kill-decision.js";
import { listKillTargetsIn } from "../kill-targets.js";

const runProcessKillGuard = (): never => {
  const hookDetails: unknown = JSON.parse(readFileSync(0, "utf8"));
  const shellCommand = readShellCommand(hookDetails);
  const killTargets = listKillTargetsIn(shellCommand);

  const isKillTargetsEmpty = killTargets.length === 0;
  if (isKillTargetsEmpty) {
    return allowAndExit();
  }

  const homeRoot = os.homedir();
  const claudeProcessIds = readLiveClaudeProcessIds(homeRoot);
  const decision = decideKill({ killTargets, processes: listRunningProcesses(), claudeProcessIds });

  const isDecision_tagAllow = decision._tag === "allow";
  if (isDecision_tagAllow) {
    return allowAndExit();
  }

  return printDecisionAndExit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: decision.reason,
    },
  });
};

try {
  runProcessKillGuard();
} catch (failure) {
  const isDebugLogging = readSettings().debugLogs;
  if (isDebugLogging) {
    writeSync(2, `process-kill-guard error: ${readFailureText(failure)}\n`);
  }

  process.exit(0);
}
