#!/usr/bin/env node

import { readFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFailureText } from "../../failure-text.js";

import { readSettings } from "../../hook-config.js";
import { allowAndExit, printDecisionAndExit } from "../../hook-output.js";
import { decideScratchWrite, type ToolCall } from "../scratch-write-decision.js";

const isPlainObject = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const readStringField = (fields: Record<string, unknown>, property: string): string | undefined => {
  const candidate = fields[property];

  const isCandidateString = typeof candidate === "string";
  return isCandidateString ? candidate : undefined;
};

const readWorkingDirectory = (hookDetails: Record<string, unknown>): string | undefined => {
  const hookDirectory = readStringField(hookDetails, "cwd");

  const hasHookDirectory = hookDirectory != null;
  if (hasHookDirectory) {
    return hookDirectory;
  }

  // Codex shell calls carry their directory in the tool input instead of the hook input.
  const toolDetails = hookDetails.tool_input;

  const isToolDetailsInvalid = !isPlainObject(toolDetails);
  if (isToolDetailsInvalid) {
    return undefined;
  }

  return readStringField(toolDetails, "cwd") || readStringField(toolDetails, "workdir");
};

const decodeToolCall = (candidate: unknown): ToolCall | undefined => {
  const isCandidateInvalid = !isPlainObject(candidate);
  if (isCandidateInvalid) {
    return undefined;
  }

  const toolName = readStringField(candidate, "tool_name");

  const isToolNameMissing = toolName == null;
  if (isToolNameMissing) {
    return undefined;
  }

  return { toolName, toolInput: candidate.tool_input, workingDirectory: readWorkingDirectory(candidate) };
};

const runScratchFolderGuard = (): never => {
  const toolCall = decodeToolCall(JSON.parse(readFileSync(0, "utf8")));

  const hasNoToolCall = !toolCall;
  if (hasNoToolCall) {
    return allowAndExit();
  }

  const decision = decideScratchWrite({ ...toolCall, systemScratchFolder: tmpdir() });

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
  runScratchFolderGuard();
} catch (failure) {
  const isDebugLogging = readSettings().debugLogs;
  if (isDebugLogging) {
    writeSync(2, `scratch-folder-guard error: ${readFailureText(failure)}\n`);
  }

  process.exit(0);
}
