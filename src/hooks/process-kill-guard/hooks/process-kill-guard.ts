#!/usr/bin/env node
// PreToolUse hook that blocks pkill and killall patterns that would also stop Claude Code sessions, the terminal they
// run in, or apps the pattern does not name; fails open.

import { readFileSync, writeSync } from "node:fs";
import os from "node:os";
import { shellCommandOf } from "../../lib/bash-hook-input.js";
import { liveClaudeProcessIds } from "../../lib/claude-live-sessions.js";
import { readConfig } from "../../lib/hook-config.js";
import { allowAndExit, printDecisionAndExit } from "../../lib/hook-output.js";
import { runningProcesses } from "../../lib/process-table.js";
import { decideKill } from "../lib/kill-decision.js";
import { killTargetsIn } from "../lib/kill-targets.js";

const runProcessKillGuard = (): never => {
  const hookInput: unknown = JSON.parse(readFileSync(0, "utf8"));
  const shellCommand = shellCommandOf(hookInput);
  const killTargets = killTargetsIn(shellCommand);
  if (killTargets.length === 0) {
    return allowAndExit();
  }

  const homeRoot = os.homedir();
  const claudeProcessIds = liveClaudeProcessIds(homeRoot);
  const decision = decideKill({ killTargets, processes: runningProcesses(), claudeProcessIds });
  if (decision._tag === "allow") {
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
  if (readConfig().debugLogs) {
    writeSync(2, `process-kill-guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
