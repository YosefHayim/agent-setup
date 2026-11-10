#!/usr/bin/env node

import { writeSync } from "node:fs";
import os from "node:os";
import { parseArgs } from "node:util";
import { readDiskCleanupWaitLimitMilliseconds } from "../../environment.js";
import { readFailureText } from "../../failure-text.js";
import { readSettings } from "../../hook-config.js";
import { claimIntervalSlot } from "../../interval-stamp.js";
import { acquireWatcherLock, isWatcherLockHeldByOther, releaseWatcherLock } from "../../watcher-lock.js";
import { cleanUpCaches } from "../cache-cleanup.js";
import { appendToCleanupLog } from "../cleanup-log.js";
import { cacheCleanupStampFile, readCleanupLockFile } from "../cleanup-state.js";
import { isSessionLive } from "../live-sessions.js";
import { reportLine } from "../report-line.js";
import { pushUnpushedBranches } from "../unpushed-branches.js";
import { cleanUpWorktrees } from "../worktree-cleanup.js";

type WatcherSettings = {
  readonly sessionId: string;
  readonly wait: boolean;
  readonly cachesOnly: boolean;
  readonly dryRun: boolean;
};

const WAIT_POLL_MILLISECONDS = 2_000;
const DEFAULT_WAIT_LIMIT_MILLISECONDS = 10 * 60 * 1_000;
// Sessions end many times a day; the caches only need a look once a day.
const CACHE_CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60;

const decodeWatcherSettings = (argv: ReadonlyArray<string>): WatcherSettings => {
  const { values: fields } = parseArgs({
    args: [...argv],
    options: {
      session: { type: "string", default: "" },
      wait: { type: "boolean", default: false },
      "caches-only": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  return {
    sessionId: fields.session,
    wait: fields.wait,
    cachesOnly: fields["caches-only"],
    dryRun: fields["dry-run"],
  };
};

const waitLimitMilliseconds = (): number => readDiskCleanupWaitLimitMilliseconds() ?? DEFAULT_WAIT_LIMIT_MILLISECONDS;

const pause = (milliseconds: number): Promise<void> => new Promise((fulfill) => setTimeout(fulfill, milliseconds));

// SessionEnd runs before the agent exits, and the agent's own folder only frees up once it has. While another
// watcher holds the lock this one cannot act anyway, so it does not look at the session until the lock frees.
const waitUntilReady = async (request: { readonly homeRoot: string; readonly sessionId: string }) => {
  const deadline = Date.now() + waitLimitMilliseconds();
  while (Date.now() < deadline) {
    const isLockFree = !isWatcherLockHeldByOther(readCleanupLockFile());

    const isWatcherLockClaimed = isLockFree && !isSessionLive(request) && acquireWatcherLock(readCleanupLockFile());
    if (isWatcherLockClaimed) {
      return true;
    }

    await pause(WAIT_POLL_MILLISECONDS);
  }
  return false;
};

const isCacheCleanupDue = (settings: WatcherSettings): boolean =>
  settings.dryRun ||
  claimIntervalSlot({ stampFile: cacheCleanupStampFile(), minimumSeconds: CACHE_CLEANUP_INTERVAL_SECONDS });

const claimCleanupTurn = (request: { readonly homeRoot: string; readonly options: WatcherSettings }) => {
  const isNotWaiting = !request.options.wait;
  if (isNotWaiting) {
    return Promise.resolve(acquireWatcherLock(readCleanupLockFile()));
  }

  return waitUntilReady({ homeRoot: request.homeRoot, sessionId: request.options.sessionId });
};

const logGivingUp = (settings: WatcherSettings): void => {
  const isWaitSkipped = !settings.wait || settings.dryRun;
  if (isWaitSkipped) {
    return;
  }

  const target = `session ${settings.sessionId}`;
  appendToCleanupLog([reportLine({ action: "gave up", detail: "wait limit reached", target })]);
};

const runWatcher = async (): Promise<void> => {
  const settings = decodeWatcherSettings(process.argv.slice(2));
  const homeRoot = os.homedir();
  // The hook starts this watcher in the ended session's folder, which may be one of the worktrees it removes.
  process.chdir(homeRoot);

  const hasNoTurn = !(await claimCleanupTurn({ homeRoot, options: settings }));
  if (hasNoTurn) {
    logGivingUp(settings);
    return;
  }

  try {
    const cleanupRequest = { homeRoot, endedSessionId: settings.sessionId, dryRun: settings.dryRun };
    const rootFolders = readSettings().diskCleanupRoots;

    const isCachesOnly = settings.cachesOnly;
    const worktreeLines = isCachesOnly ? [] : cleanUpWorktrees({ ...cleanupRequest, rootFolders });
    const branchLines = isCachesOnly ? [] : pushUnpushedBranches({ ...cleanupRequest, rootFolders });
    const cacheLines = isCacheCleanupDue(settings) ? cleanUpCaches(cleanupRequest) : [];
    const reportLines = [...worktreeLines, ...branchLines, ...cacheLines];
    writeSync(1, reportLines.map((line) => `${line}\n`).join(""));

    const isNotDryRun = !settings.dryRun;
    if (isNotDryRun) {
      appendToCleanupLog(reportLines);
    }
  } finally {
    releaseWatcherLock(readCleanupLockFile());
  }
};

runWatcher().catch((failure: unknown) => {
  const isDebugLogging = readSettings().debugLogs;
  if (isDebugLogging) {
    writeSync(2, `disk-cleanup error: ${readFailureText(failure)}\n`);
  }

  process.exit(0);
});
