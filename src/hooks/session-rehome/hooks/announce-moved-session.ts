#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAgentId } from "../../environment.js";
import { allowAndExit, printDecisionAndExit } from "../../hook-output.js";
import { readMovedSessionNotice } from "../moved-session-notice.js";
import {
  claimSweepSlot,
  readLastMoves,
  readLedgerLine,
  readRehomeAgentFrom,
  saveLedgerLine,
} from "../rehome-ledger.js";

type SessionStartEvent = { readonly sessionId: string; readonly source: string; readonly cwd: string };

const SWEEP_EVERY_SECONDS = 10 * 60;

const readStringProperty = (candidate: object, property: string): string => {
  const field = Object.getOwnPropertyDescriptor(candidate, property)?.value;

  const isStringField = typeof field === "string";
  return isStringField ? field : "";
};

const decodeSessionStart = (candidate: unknown): SessionStartEvent | null => {
  const isNotSessionStartObject =
    typeof candidate !== "object" || candidate === null || !readStringProperty(candidate, "session_id");
  if (isNotSessionStartObject) {
    return null;
  }

  return {
    sessionId: readStringProperty(candidate, "session_id"),
    source: readStringProperty(candidate, "source"),
    cwd: readStringProperty(candidate, "cwd"),
  };
};

// The watcher has this file's extension: .js when installed, .ts under tsx in tests.
const startSweepIfDue = (): void => {
  const isSweepSlotTaken = !claimSweepSlot(SWEEP_EVERY_SECONDS);
  if (isSweepSlotTaken) {
    return;
  }

  const hookFile = fileURLToPath(import.meta.url);
  const watcherFile = path.join(path.dirname(hookFile), "..", "watchers", `rehomeWatcher${path.extname(hookFile)}`);
  spawn(process.execPath, [...process.execArgv, watcherFile, "--sweep"], { detached: true, stdio: "ignore" }).unref();
};

const readAnnounceMovedSession = (): never => {
  const agentId = readAgentId();
  const agent = readRehomeAgentFrom(agentId);

  const sessionStart = decodeSessionStart(JSON.parse(readFileSync(0, "utf8")));

  const hasNoAgentOrSession = !agent || !sessionStart;
  if (hasNoAgentOrSession) {
    return allowAndExit();
  }

  startSweepIfDue();
  const line = readLedgerLine({ ledger: readLastMoves(), agent, sessionId: sessionStart.sessionId });
  const homeRoot = os.homedir();

  const isResumedWithLine = sessionStart.source === "resume" && line != null;
  const notice = isResumedWithLine ? readMovedSessionNotice({ entry: line, cwd: sessionStart.cwd, homeRoot }) : null;

  const hasNoLineOrNotice = !line || !notice;
  if (hasNoLineOrNotice) {
    return allowAndExit();
  }

  const isAgentCodex = agent === "codex";
  if (isAgentCodex) {
    saveLedgerLine({ ...line, notifiedAt: new Date().toISOString() });
  }

  const hasAgentNote = notice.agentContext !== "";
  return printDecisionAndExit({
    systemMessage: notice.userMessage,
    ...(hasAgentNote
      ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: notice.agentContext } }
      : {}),
  });
};

try {
  readAnnounceMovedSession();
} catch {
  process.exit(0);
}
