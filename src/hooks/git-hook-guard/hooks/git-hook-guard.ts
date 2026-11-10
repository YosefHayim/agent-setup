#!/usr/bin/env node

import { readFileSync, writeSync } from "node:fs";
import { readShellCommand, startFolderOf } from "../../bash-hook-input.js";
import { readFailureText } from "../../failure-text.js";
import { readSettings } from "../../hook-config.js";
import { allowAndExit, printDecisionAndExit } from "../../hook-output.js";
import { decideGitHook } from "../git-hook-decision.js";
import { inspectRepoHooks } from "../hooks-installed.js";

const runGitHookGuard = (): never => {
  const hookDetails: unknown = JSON.parse(readFileSync(0, "utf8"));
  const command = readShellCommand(hookDetails);
  const startFolder = startFolderOf(hookDetails);
  const decision = decideGitHook({ command, startFolder, inspectRepo: inspectRepoHooks });

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
  runGitHookGuard();
} catch (failure) {
  const isDebugLogging = readSettings().debugLogs;
  if (isDebugLogging) {
    writeSync(2, `git-hook-guard error: ${readFailureText(failure)}\n`);
  }

  process.exit(0);
}
