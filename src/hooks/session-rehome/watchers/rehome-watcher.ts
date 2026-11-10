#!/usr/bin/env node

import { existsSync, writeSync } from "node:fs";
import os from "node:os";
import { parseArgs } from "node:util";
import { readFailureText } from "../../failure-text.js";

import { readSettings } from "../../hook-config.js";
import { acquireWatcherLock, isWatcherLockHeldByOther, releaseWatcherLock } from "../../watcher-lock.js";
import { type ClaudeSession, findClaudeSession, isClaudeSessionLive } from "../claude-sessions.js";
import { isCodexThreadLive, listCodexThreads } from "../codex-threads.js";
import { discoverRepos } from "../local-repos.js";
import { type RehomeAgent, readRehomeLockFile } from "../rehome-ledger.js";
import { runSweep, type SessionPlan } from "../session-sweep.js";

type WatcherSettings = {
  readonly agents: ReadonlyArray<RehomeAgent>;
  readonly sessionId: string;
  readonly wait: boolean;
  readonly sweep: boolean;
  readonly reevaluate: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly deletedRepoNames: ReadonlySet<string>;
  readonly assignments: ReadonlyMap<string, string>;
};

// A sweep leaves anything written in the last five minutes alone; a session handed over by SessionEnd only needs
// its agent to finish the last write.
const SWEEP_QUIET_SECONDS = 300;
const ENDED_SESSION_QUIET_SECONDS = 5;
const WAIT_POLL_MILLISECONDS = 2_000;
const WAIT_LIMIT_MILLISECONDS = 10 * 60 * 1_000;

const USAGE = `usage: rehomeWatcher --sweep [--all] [--dry-run] [--json] [--agent claude-code|codex|all]
       rehomeWatcher --session <id> [--agent <agent>] [--wait]
       options: --delete-repo <name>[,<name>] --assign <session-id-prefix>=<repo>\n`;

const listAgentsFor = (agentOption: string): ReadonlyArray<RehomeAgent> => {
  switch (agentOption) {
    case "claude-code":
      return ["claude-code"];
    case "codex":
      return ["codex"];
    default:
      return ["claude-code", "codex"];
  }
};

// e.g. ["aria,tend", "extension-installer"] → {"aria", "tend", "extension-installer"}
const splitNames = (fields: ReadonlyArray<string>): ReadonlyArray<string> =>
  fields
    .flatMap((field) => field.split(","))
    .map((name) => name.trim())
    .filter(Boolean);

// e.g. "5cc2fa97=vybekiit" → ["5cc2fa97", "vybekiit"]
const decodeAssignments = (fields: ReadonlyArray<string>): ReadonlyMap<string, string> =>
  new Map(
    fields.flatMap((field) => {
      const [sessionPrefix, repoName] = field.split("=").map((part) => part.trim());

      const hasSessionPrefixAndRepoName = sessionPrefix && repoName;
      return hasSessionPrefixAndRepoName ? [[sessionPrefix, repoName] as const] : [];
    }),
  );

const decodeWatcherSettings = (argv: ReadonlyArray<string>): WatcherSettings => {
  const { values: fields } = parseArgs({
    args: [...argv],
    options: {
      agent: { type: "string", default: "all" },
      session: { type: "string", default: "" },
      wait: { type: "boolean", default: false },
      sweep: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "delete-repo": { type: "string", multiple: true, default: [] },
      assign: { type: "string", multiple: true, default: [] },
    },
    strict: true,
  });
  return {
    agents: listAgentsFor(fields.agent),
    sessionId: fields.session,
    wait: fields.wait,
    sweep: fields.sweep,
    reevaluate: fields.all || fields.session !== "",
    dryRun: fields["dry-run"],
    json: fields.json,
    deletedRepoNames: new Set(splitNames(fields["delete-repo"])),
    assignments: decodeAssignments(fields.assign),
  };
};

const pause = (milliseconds: number): Promise<void> => new Promise((fulfill) => setTimeout(fulfill, milliseconds));

const NOT_LIVE = (): boolean => false;

// Another watcher may move the session while this one waits, so a transcript that is gone is looked up again.
const readCurrentClaudeSession = (request: { readonly homeRoot: string; readonly session: ClaudeSession }) => {
  const isTranscriptPresent = existsSync(request.session.transcriptFile);
  return isTranscriptPresent
    ? request.session
    : findClaudeSession({ homeRoot: request.homeRoot, sessionId: request.session.sessionId });
};

// Finding the session reads every project folder and listing Codex threads opens its database, so the ended session
// is looked up once and each poll only asks whether its agent has let go.
const readLiveCheck = async (request: { readonly homeRoot: string; readonly options: WatcherSettings }) => {
  const { homeRoot, options: settings } = request;

  const isClaudeCodeSelected = settings.agents.includes("claude-code");
  const claudeSession = isClaudeCodeSelected
    ? findClaudeSession({ homeRoot, sessionId: settings.sessionId })
    : undefined;

  const hasClaudeSession = claudeSession;
  if (hasClaudeSession) {
    return () => {
      const session = readCurrentClaudeSession({ homeRoot, session: claudeSession });
      return session != null && isClaudeSessionLive({ homeRoot, session, quietSeconds: ENDED_SESSION_QUIET_SECONDS });
    };
  }

  const isCodexSelected = settings.agents.includes("codex");
  const codexThread = isCodexSelected
    ? (await listCodexThreads(homeRoot)).find((thread) => thread.threadId === settings.sessionId)
    : undefined;

  const hasNoCodexThread = !codexThread;
  if (hasNoCodexThread) {
    return NOT_LIVE;
  }

  return () => isCodexThreadLive({ homeRoot, thread: codexThread, quietSeconds: ENDED_SESSION_QUIET_SECONDS });
};

// SessionEnd runs before the agent's last writes and exit, so the hand-over waits for the agent to let go. While
// another watcher holds the lock this one cannot act anyway, so it does not look at the session until the lock frees.
const waitUntilReady = async (request: { readonly homeRoot: string; readonly options: WatcherSettings }) => {
  const deadline = Date.now() + WAIT_LIMIT_MILLISECONDS;
  const isSessionLive = await readLiveCheck(request);
  while (Date.now() < deadline) {
    const isLockFree = !isWatcherLockHeldByOther(readRehomeLockFile());

    const isLockFreeAndNotLive = isLockFree && !(await isSessionLive()) && acquireWatcherLock(readRehomeLockFile());
    if (isLockFreeAndNotLive) {
      return true;
    }

    await pause(WAIT_POLL_MILLISECONDS);
  }
  return false;
};

const describePlan = (plan: SessionPlan): string => {
  const isMoveAction = plan.action === "move";
  const target = isMoveAction ? `→ ${plan.repoName} (${Math.round(plan.share * 100)}%)` : plan.repoName;
  const candidates = plan.candidates.map((candidate) => `${candidate.repoName} ${Math.round(candidate.share * 100)}%`);

  const isUncertainAction = plan.action === "uncertain";
  const detail = isUncertainAction ? `candidates: ${candidates.join(", ") || "none"}` : target;
  return [
    plan.agent.padEnd(11),
    plan.sessionId,
    plan.action.padEnd(9),
    plan.status.padEnd(9),
    plan.fromFolder,
    detail,
    JSON.stringify(plan.title.slice(0, 80)),
  ].join("  ");
};

const printPlans = (request: { readonly plans: ReadonlyArray<SessionPlan>; readonly json: boolean }): void => {
  const isMachineReadable = request.json;
  const report = isMachineReadable
    ? `${JSON.stringify(request.plans, null, 2)}\n`
    : request.plans.map((plan) => `${describePlan(plan)}\n`).join("");
  writeSync(1, report);
};

const runWatcher = async (): Promise<void> => {
  const settings = decodeWatcherSettings(process.argv.slice(2));

  const hasNoSweepOrSession = !settings.sweep && !settings.sessionId;
  if (hasNoSweepOrSession) {
    writeSync(2, USAGE);
    return;
  }

  const homeRoot = os.homedir();

  const isWaitRequested = settings.wait;
  const ready = isWaitRequested
    ? await waitUntilReady({ homeRoot, options: settings })
    : acquireWatcherLock(readRehomeLockFile());

  const isNotReady = !ready;
  if (isNotReady) {
    return;
  }

  const hasSessionId = settings.sessionId !== "";
  try {
    const repos = discoverRepos({
      homeRoot,
      rootFolders: readSettings().sessionRehomeRoots,
      deletedRepoNames: [...settings.deletedRepoNames],
    });
    const plans = await runSweep({
      homeRoot,
      repos,
      agents: settings.agents,
      sessionId: settings.sessionId,
      reevaluate: settings.reevaluate,
      dryRun: settings.dryRun,
      deletedRepoNames: settings.deletedRepoNames,
      assignments: settings.assignments,
      quietSeconds: hasSessionId ? ENDED_SESSION_QUIET_SECONDS : SWEEP_QUIET_SECONDS,
    });
    printPlans({ plans, json: settings.json });
  } finally {
    releaseWatcherLock(readRehomeLockFile());
  }
};

runWatcher().catch((failure: unknown) => {
  const isDebugLogging = readSettings().debugLogs;
  if (isDebugLogging) {
    writeSync(2, `session-rehome error: ${readFailureText(failure)}\n`);
  }

  process.exit(0);
});
