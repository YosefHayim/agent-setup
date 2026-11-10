import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readRehomeStateFolder } from "../environment.js";
import { installRoot } from "../hook-config.js";
import { claimIntervalSlot } from "../interval-stamp.js";
import { appendLine, decodeLine } from "../json-lines.js";

export type RehomeAgent = "claude-code" | "codex";

export const readRehomeAgentFrom = (agentId: string | null): RehomeAgent | null => {
  const isKnownAgent = agentId === "claude-code" || agentId === "codex";
  return isKnownAgent ? agentId : null;
};

export type LedgerDecision = "moved" | "stayed" | "uncertain" | "no-signal" | "deleted" | "conflict";

export type LedgerLine = {
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

const readStorageFolder = (): string => readRehomeStateFolder() ?? path.join(installRoot, "state", "session-rehome");

const readLedgerFile = (): string => path.join(readStorageFolder(), "ledger.jsonl");

const readLedgerKey = (request: { readonly agent: RehomeAgent; readonly sessionId: string }): string =>
  `${request.agent}:${request.sessionId}`;

const readStringOf = (fields: Record<string, unknown>, property: string): string => {
  const candidate = fields[property];

  const isStringCandidate = typeof candidate === "string";
  return isStringCandidate ? candidate : "";
};

const decodeLedgerLine = (fields: Record<string, unknown>): LedgerLine | null => {
  const agent = readRehomeAgentFrom(readStringOf(fields, "agent"));

  const decision = LEDGER_DECISIONS.find((candidate) => candidate === fields.decision);

  const hasNoRequiredField = !agent || !decision || !readStringOf(fields, "sessionId");
  if (hasNoRequiredField) {
    return null;
  }

  const share = fields.share;
  const isShareNumber = typeof share === "number";

  return {
    agent,
    sessionId: readStringOf(fields, "sessionId"),
    decision,
    title: readStringOf(fields, "title"),
    fromFolder: readStringOf(fields, "fromFolder"),
    toFolder: readStringOf(fields, "toFolder"),
    repoName: readStringOf(fields, "repoName"),
    share: isShareNumber ? share : 0,
    decidedAt: readStringOf(fields, "decidedAt"),
    notifiedAt: readStringOf(fields, "notifiedAt"),
  };
};

const readNewestPerSession = (request: { readonly keep: (line: LedgerLine) => boolean }) => {
  const entries = new Map<string, LedgerLine>();

  const isLedgerPresent = existsSync(readLedgerFile());
  const lines = isLedgerPresent ? readFileSync(readLedgerFile(), "utf8").split("\n") : [];
  for (const ledgerLine of lines.map(decodeLine).map(decodeLedgerLine)) {
    const isLedgerLineKept = ledgerLine && request.keep(ledgerLine);
    if (isLedgerLineKept) {
      entries.set(readLedgerKey(ledgerLine), ledgerLine);
    }
  }
  return entries;
};

export const readLedger = (): ReadonlyMap<string, LedgerLine> => readNewestPerSession({ keep: () => true });

// A moved session that later ends in its new home is recorded as kept there; where it moved from still matters
// when it is resumed from the old folder.
export const readLastMoves = (): ReadonlyMap<string, LedgerLine> =>
  readNewestPerSession({ keep: (line) => line.decision === "moved" });

export const readLedgerLine = (request: {
  readonly ledger: ReadonlyMap<string, LedgerLine>;
  readonly agent: RehomeAgent;
  readonly sessionId: string;
}): LedgerLine | null => request.ledger.get(readLedgerKey(request)) ?? null;

export const saveLedgerLine = (ledgerLine: LedgerLine): void => {
  mkdirSync(readStorageFolder(), { recursive: true });
  appendLine({ file: readLedgerFile(), line: ledgerLine });
};

const readSweepStampFile = (): string => path.join(readStorageFolder(), "last-sweep");

// SessionStart fires on every launch; a full sweep reads every transcript, so it runs at most this often.
export const claimSweepSlot = (minimumSeconds: number): boolean =>
  claimIntervalSlot({ stampFile: readSweepStampFile(), minimumSeconds });

export const readRehomeLockFile = (): string => path.join(readStorageFolder(), "watcher.lock");
