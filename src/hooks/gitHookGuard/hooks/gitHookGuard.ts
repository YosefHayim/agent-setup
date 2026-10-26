#!/usr/bin/env node
// PreToolUse hook that blocks git commands that skip or disable git hooks, and commits and pushes in a repo whose hooks
// are not installed; fails open.

import { readFileSync, writeSync } from "node:fs";

import { shellCommandOf, startFolderOf } from "../../lib/bashHookInput.js";
import { readConfig } from "../../lib/hookConfig.js";
import { allowAndExit, printDecisionAndExit } from "../../lib/hookOutput.js";
import { decideGitHook } from "../lib/gitHookDecision.js";
import { inspectRepoHooks } from "../lib/hooksInstalled.js";

const runGitHookGuard = (): never => {
  const hookInput: unknown = JSON.parse(readFileSync(0, "utf8"));
  const command = shellCommandOf(hookInput);
  const startFolder = startFolderOf(hookInput);
  const decision = decideGitHook({ command, startFolder, inspectRepo: inspectRepoHooks });
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
  runGitHookGuard();
} catch (failure) {
  if (readConfig().debugLogs) {
    writeSync(2, `git-hook-guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
