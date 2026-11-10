// The ledger remembers every decision, so a sweep never re-reads a settled session and SessionStart can say where
// a resumed session went. One JSON record per line; the newest record for a session wins.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { installRoot } from "../hook-config.js";
import { claimIntervalSlot } from "../interval-stamp.js";
import { appendJsonLine, decodeJsonLine } from "../json-lines.js";

export type RehomeAgent = "claude-code" | "codex";

export const rehomeAgentFrom = (agentId: string | undefined): RehomeAgent | undefined =>
  agentId === "claude-code" || agentId === "codex" ? agentId : undefined;

export type LedgerDecision = "moved" | "stayed" | "uncertain" | "no-signal" | "deleted" | "conflict";

export type LedgerEntry = {
  readonly agent: RehomeAgent;
  readonly sessionId: string;
  readonly decision: LedgerDecision;
  readonly title: string;
  readonly fromFolder: string;
  readonly toFolder: string;
  readonly repoName: string;
  readonly share: number;
  readonly decidedAt: string;
  /** When SessionStart last told the user this session moved; Codex announces each move once. */
  readonly notifiedAt: string;
};

const LEDGER_DECISIONS: ReadonlyArray<LedgerDecision> = [
  "moved",
  "stayed",
  "uncertain",
  "no-signal",
  "deleted",
  "conflict",
];

const stateFolder = (): string =>
  process.env.AGENT_SETUP_REHOME_STATE_DIR || path.join(installRoot, "state", "session-rehome");

const ledgerFile = (): string => path.join(stateFolder(), "ledger.jsonl");

const ledgerKey = (request: { readonly agent: RehomeAgent; readonly sessionId: string }): string =>
  `${request.agent}:${request.sessionId}`;

const textOf = (record: Record<string, unknown>, property: string): string => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : "";
};

const decodeLedgerEntry = (record: Record<string, unknown>): LedgerEntry | undefined => {
  const agent = record.agent === "claude-code" || record.agent === "codex" ? record.agent : undefined;
  const decision = LEDGER_DECISIONS.find((candidate) => candidate === record.decision);
  if (!agent || !decision || !textOf(record, "sessionId")) {
    return undefined;
  }

  return {
    agent,
    sessionId: textOf(record, "sessionId"),
    decision,
    title: textOf(record, "title"),
    fromFolder: textOf(record, "fromFolder"),
    toFolder: textOf(record, "toFolder"),
    repoName: textOf(record, "repoName"),
    share: typeof record.share === "number" ? record.share : 0,
    decidedAt: textOf(record, "decidedAt"),
    notifiedAt: textOf(record, "notifiedAt"),
  };
};

const newestPerSession = (request: { readonly keep: (entry: LedgerEntry) => boolean }) => {
  const entries = new Map<string, LedgerEntry>();
  const lines = existsSync(ledgerFile()) ? readFileSync(ledgerFile(), "utf8").split("\n") : [];
  for (const entry of lines.map(decodeJsonLine).map(decodeLedgerEntry)) {
    if (entry && request.keep(entry)) {
      entries.set(ledgerKey(entry), entry);
    }
  }
  return entries;
};

export const readLedger = (): ReadonlyMap<string, LedgerEntry> => newestPerSession({ keep: () => true });

// A moved session that later ends in its new home is recorded as kept there; where it moved from still matters
// when it is resumed from the old folder.
export const readLastMoves = (): ReadonlyMap<string, LedgerEntry> =>
  newestPerSession({ keep: (entry) => entry.decision === "moved" });

export const ledgerEntryFor = (request: {
  readonly ledger: ReadonlyMap<string, LedgerEntry>;
  readonly agent: RehomeAgent;
  readonly sessionId: string;
}): LedgerEntry | undefined => request.ledger.get(ledgerKey(request));

export const recordLedgerEntry = (entry: LedgerEntry): void => {
  mkdirSync(stateFolder(), { recursive: true });
  appendJsonLine({ file: ledgerFile(), line: entry });
};

const sweepStampFile = (): string => path.join(stateFolder(), "last-sweep");

// SessionStart fires on every launch; a full sweep reads every transcript, so it runs at most this often.
export const claimSweepSlot = (minimumSeconds: number): boolean =>
  claimIntervalSlot({ stampFile: sweepStampFile(), minimumSeconds });

export const rehomeLockFile = (): string => path.join(stateFolder(), "watcher.lock");
