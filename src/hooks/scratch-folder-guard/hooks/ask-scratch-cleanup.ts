#!/usr/bin/env node
// Stop hook that asks the agent to delete its session's scratch files once the user's work is finished; fails open.

import { readFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readConfig } from "../../lib/hook-config.js";
import { allowAndExit, printDecisionAndExit } from "../../lib/hook-output.js";
import { SESSION_ID_PATTERN } from "../../lib/session-ids.js";
import { readTranscriptHead } from "../../lib/transcript-reader.js";
import { decideScratchCleanup } from "../lib/scratch-cleanup-decision.js";
import { agentScratchFolders, holdsFiles } from "../lib/session-scratch.js";

// A thread opened in the terminal or the editor; "exec" and subagent threads have nobody reading along.
const INTERACTIVE_CODEX_SOURCES = ["cli", "vscode"];

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const listsEntries = (candidate: unknown): boolean => Array.isArray(candidate) && candidate.length > 0;

// Codex gives hooks no interactive flag; the rollout's first line records how the thread was started.
const codexThreadIsInteractive = (rolloutFile: unknown): boolean => {
  if (typeof rolloutFile !== "string") {
    return false;
  }

  const [threadHeaderLine = ""] = readTranscriptHead(rolloutFile);
  const threadHeader: unknown = JSON.parse(threadHeaderLine);
  const threadStart = isRecord(threadHeader) ? threadHeader.payload : undefined;
  return isRecord(threadStart) && INTERACTIVE_CODEX_SOURCES.some((source) => source === threadStart.source);
};

// A headless run prints its last message as its answer, so a cleanup turn would replace what its caller reads.
// A session that does not say a person is at it is therefore never asked.
const sessionIsAttended = (hookInput: Record<string, unknown>): boolean => {
  const agentId = process.env.AGENT_SETUP_AGENT_ID;
  if (agentId === "claude-code") {
    return process.env.CLAUDE_CODE_SESSION_ATTENDED === "1";
  }

  return agentId === "codex" && codexThreadIsInteractive(hookInput.transcript_path);
};

const runAskScratchCleanup = (): never => {
  const hookInput: unknown = JSON.parse(readFileSync(0, "utf8"));
  const sessionId = isRecord(hookInput) ? hookInput.session_id : undefined;
  if (!isRecord(hookInput) || typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    return allowAndExit();
  }

  const homeRoot = process.env.HOME || os.homedir();
  const sessionScratchFolders = agentScratchFolders({ homeRoot, sessionId });
  // The command has this file's extension: .js when installed, .ts under tsx in tests.
  const hookFile = fileURLToPath(import.meta.url);
  const hookFolder = path.dirname(hookFile);
  const commandFile = path.join(hookFolder, "..", "command", `clear-scratch${path.extname(hookFile)}`);
  const decision = decideScratchCleanup({
    alreadyContinuing: hookInput.stop_hook_active === true,
    // Claude Code lists what is still in flight or scheduled; Codex sends neither list.
    workPending: listsEntries(hookInput.background_tasks) || listsEntries(hookInput.session_crons),
    attended: sessionIsAttended(hookInput),
    scratchFoldersWithFiles: sessionScratchFolders.filter(holdsFiles),
    cleanupCommand: `node "${commandFile}" ${sessionId}`,
  });
  if (decision._tag === "quiet") {
    return allowAndExit();
  }

  if (process.env.AGENT_SETUP_AGENT_ID === "claude-code") {
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
  if (readConfig().debugLogs) {
    writeSync(2, `scratch-folder-guard error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
}
