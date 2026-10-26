#!/usr/bin/env node
// PreToolUse hook that blocks pkill and killall patterns that would also stop Claude Code sessions, the terminal they
// run in, or apps the pattern does not name; fails open.

import { readFileSync, writeSync } from "node:fs";
import os from "node:os";

import { liveClaudeProcessIds } from "../../lib/claudeLiveSessions.js";
import { readConfig } from "../../lib/hookConfig.js";
import { allowAndExit, printDecisionAndExit } from "../../lib/hookOutput.js";
import { isRecord } from "../../lib/jsonLines.js";
import { decideKill } from "../lib/killDecision.js";
import { killTargetsIn } from "../lib/killTargets.js";
import { runningProcesses } from "../lib/processTable.js";

// Claude Code names the shell command "command"; Codex names it "cmd".
const shellCommandOf = (hookInput: unknown): string => {
  if (!isRecord(hookInput) || !isRecord(hookInput.tool_input)) {
    return "";
  }

  const { command, cmd } = hookInput.tool_input;
  if (typeof command === "string") {
    return command;
  }

  return typeof cmd === "string" ? cmd : "";
};

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
