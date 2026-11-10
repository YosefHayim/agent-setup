#!/usr/bin/env node
// PreToolUse hook that blocks agent writes into system temporary folders such as /tmp; fails open.

import { readFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";

import { readConfig } from "../../hook-config.js";
import { allowAndExit, printDecisionAndExit } from "../../hook-output.js";
import { decideScratchWrite, type ToolCall } from "../scratch-write-decision.js";

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const stringField = (record: Record<string, unknown>, property: string): string | undefined => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : undefined;
};

const workingDirectoryOf = (hookInput: Record<string, unknown>): string | undefined => {
  const hookDirectory = stringField(hookInput, "cwd");
  if (hookDirectory !== undefined) {
    return hookDirectory;
  }

  // Codex shell calls carry their directory in the tool input instead of the hook input.
  const toolInput = hookInput.tool_input;
  if (!isRecord(toolInput)) {
    return undefined;
  }

  return stringField(toolInput, "cwd") || stringField(toolInput, "workdir");
};

const decodeToolCall = (candidate: unknown): ToolCall | undefined => {
  if (!isRecord(candidate)) {
    return undefined;
  }

  const toolName = stringField(candidate, "tool_name");
  if (toolName === undefined) {
    return undefined;
  }

  return { toolName, toolInput: candidate.tool_input, workingDirectory: workingDirectoryOf(candidate) };
};

const runScratchFolderGuard = (): never => {
  const toolCall = decodeToolCall(JSON.parse(readFileSync(0, "utf8")));
  if (!toolCall) {
    return allowAndExit();
  }

  const decision = decideScratchWrite({ ...toolCall, systemScratchFolder: tmpdir() });
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
  runScratchFolderGuard();
} catch (failure) {
  if (readConfig().debugLogs) {
    writeSync(2, `scratch-folder-guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
