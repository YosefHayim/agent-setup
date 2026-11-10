#!/usr/bin/env node

import { readFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAgentId, readClaudeCodeSessionAttended } from "../../environment.js";
import { readFailureText } from "../../failure-text.js";
import { readSettings } from "../../hook-config.js";
import { allowAndExit, printDecisionAndExit } from "../../hook-output.js";
import { SESSION_ID_PATTERN } from "../../session-ids.js";
import { readTranscriptHead } from "../../transcript-reader.js";
import { decideScratchCleanup } from "../scratch-cleanup-decision.js";
import { hasFiles, listAgentScratchFolders } from "../session-scratch.js";

// A thread opened in the terminal or the editor; "exec" and subagent threads have nobody reading along.
const INTERACTIVE_CODEX_ORIGINS = ["cli", "vscode"];

const isPlainObject = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const isListingLines = (candidate: unknown): boolean => Array.isArray(candidate) && candidate.length > 0;

// Codex gives hooks no interactive flag; the rollout's first line records how the thread was started.
const isCodexThreadInteractive = (rolloutFile: unknown): boolean => {
  const isRolloutFileMissing = typeof rolloutFile !== "string";
  if (isRolloutFileMissing) {
    return false;
  }

  const [threadHeaderLine = ""] = readTranscriptHead(rolloutFile);
  const threadHeader: unknown = JSON.parse(threadHeaderLine);
  const threadStart = isPlainObject(threadHeader) ? threadHeader.payload : null;
  return isPlainObject(threadStart) && INTERACTIVE_CODEX_ORIGINS.some((origin) => origin === threadStart.source);
};

// A headless run prints its last message as its answer, so a cleanup turn would replace what its caller reads.
// A session that does not say a person is at it is therefore never asked.
const isSessionAttended = (hookDetails: Record<string, unknown>): boolean => {
  const agentId = readAgentId();

  const isAgentIdClaudeCode = agentId === "claude-code";
  if (isAgentIdClaudeCode) {
    return readClaudeCodeSessionAttended() === "1";
  }

  return agentId === "codex" && isCodexThreadInteractive(hookDetails.transcript_path);
};

const runAskScratchCleanup = (): never => {
  const hookDetails: unknown = JSON.parse(readFileSync(0, "utf8"));

  const sessionId = isPlainObject(hookDetails) ? hookDetails.session_id : null;

  const isInvalidHookDetails =
    !isPlainObject(hookDetails) || typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId);
  if (isInvalidHookDetails) {
    return allowAndExit();
  }

  const homeRoot = os.homedir();
  const sessionScratchFolders = listAgentScratchFolders({ homeRoot, sessionId });
  // The command has this file's extension: .js when installed, .ts under tsx in tests.
  const hookFile = fileURLToPath(import.meta.url);
  const hookFolder = path.dirname(hookFile);
  const commandFile = path.join(hookFolder, "..", "command", `clear-scratch${path.extname(hookFile)}`);
  const decision = decideScratchCleanup({
    alreadyContinuing: hookDetails.stop_hook_active === true,
    // Claude Code lists what is still in flight or scheduled; Codex sends neither list.
    workPending: isListingLines(hookDetails.background_tasks) || isListingLines(hookDetails.session_crons),
    attended: isSessionAttended(hookDetails),
    scratchFoldersWithFiles: sessionScratchFolders.filter(hasFiles),
    cleanupCommand: `node "${commandFile}" ${sessionId}`,
  });

  const isDecisionQuiet = decision._tag === "quiet";
  if (isDecisionQuiet) {
    return allowAndExit();
  }

  const isClaudeCodeAgent = readAgentId() === "claude-code";

  if (isClaudeCodeAgent) {
    // Claude Code reports `decision: "block"` as a hook error; additionalContext continues the turn without one.
    return printDecisionAndExit({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: decision.question },
    });
  }

  return printDecisionAndExit({ decision: "block", reason: decision.question });
};

try {
  runAskScratchCleanup();
} catch (failure) {
  const isDebugLogging = readSettings().debugLogs;
  if (isDebugLogging) {
    writeSync(2, `scratch-folder-guard error: ${readFailureText(failure)}\n`);
  }

  process.exit(0);
}
