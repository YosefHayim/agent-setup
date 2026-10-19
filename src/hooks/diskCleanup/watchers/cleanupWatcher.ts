#!/usr/bin/env node
// Detached watcher behind the disk-cleanup hook, and the command for a manual pass:
//   node cleanupWatcher.js [--session <id>] [--wait] [--caches-only] [--dry-run]
// --session names the ended session: only the worktrees it created or worked in, and the unpushed branches of the repos
// it named, are looked at, and it no longer counts as live. Without it every worktree and repo is looked at. --wait
// first waits for that session to end. --caches-only looks at no worktree or branch, for an agent whose sessions own
// none. Each pass that is not a dry run adds what it did to the cleanup log.
// Fails open: a crash leaves every worktree, branch, and cache where it was.

import { writeSync } from "node:fs";
import os from "node:os";
import { parseArgs } from "node:util";

import { readConfig } from "../../lib/hookConfig.js";
import { claimIntervalSlot } from "../../lib/intervalStamp.js";
import { acquireWatcherLock, isWatcherLockHeldByOther, releaseWatcherLock } from "../../lib/watcherLock.js";
import { cleanUpCaches } from "../lib/cacheCleanup.js";
import { appendToCleanupLog } from "../lib/cleanupLog.js";
import { cacheCleanupStampFile, cleanupLockFile } from "../lib/cleanupState.js";
import { isSessionLive } from "../lib/liveSessions.js";
import { pushUnpushedBranches } from "../lib/unpushedBranches.js";
import { cleanUpWorktrees } from "../lib/worktreeCleanup.js";

type WatcherOptions = {
  readonly sessionId: string;
  readonly wait: boolean;
  readonly cachesOnly: boolean;
  readonly dryRun: boolean;
};

const WAIT_POLL_MILLISECONDS = 2_000;
const WAIT_LIMIT_MILLISECONDS = 10 * 60 * 1_000;
// Sessions end many times a day; the caches only need a look once a day.
const CACHE_CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60;

const decodeWatcherOptions = (argv: ReadonlyArray<string>): WatcherOptions => {
  const { values } = parseArgs({
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
    sessionId: values.session,
    wait: values.wait,
    cachesOnly: values["caches-only"],
    dryRun: values["dry-run"],
  };
};

const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

// SessionEnd runs before the agent exits, and the agent's own folder only frees up once it has. While another
// watcher holds the lock this one cannot act anyway, so it does not look at the session until the lock frees.
const waitUntilReady = async (request: { readonly homeRoot: string; readonly sessionId: string }) => {
  const deadline = Date.now() + WAIT_LIMIT_MILLISECONDS;
  while (Date.now() < deadline) {
    const isLockFree = !isWatcherLockHeldByOther(cleanupLockFile());
    if (isLockFree && !isSessionLive(request) && acquireWatcherLock(cleanupLockFile())) {
      return true;
    }
    await pause(WAIT_POLL_MILLISECONDS);
  }
  return false;
};

const isCacheCleanupDue = (options: WatcherOptions): boolean =>
  options.dryRun ||
  claimIntervalSlot({ stampFile: cacheCleanupStampFile(), minimumSeconds: CACHE_CLEANUP_INTERVAL_SECONDS });

const claimCleanupTurn = (request: { readonly homeRoot: string; readonly options: WatcherOptions }) => {
  if (!request.options.wait) {
    return Promise.resolve(acquireWatcherLock(cleanupLockFile()));
  }

  return waitUntilReady({ homeRoot: request.homeRoot, sessionId: request.options.sessionId });
};

const runWatcher = async (): Promise<void> => {
  const options = decodeWatcherOptions(process.argv.slice(2));
  const homeRoot = process.env.HOME || os.homedir();
  // The hook starts this watcher in the ended session's folder, which may be one of the worktrees it removes.
  process.chdir(homeRoot);
  const hasTurn = await claimCleanupTurn({ homeRoot, options });
  if (!hasTurn) {
    return;
  }

  try {
    const cleanupRequest = { homeRoot, endedSessionId: options.sessionId, dryRun: options.dryRun };
    const rootFolders = readConfig().diskCleanupRoots;
    const worktreeLines = options.cachesOnly ? [] : cleanUpWorktrees({ ...cleanupRequest, rootFolders });
    const branchLines = options.cachesOnly ? [] : pushUnpushedBranches({ ...cleanupRequest, rootFolders });
    const cacheLines = isCacheCleanupDue(options) ? cleanUpCaches(cleanupRequest) : [];
    const reportLines = [...worktreeLines, ...branchLines, ...cacheLines];
    writeSync(1, reportLines.map((line) => `${line}\n`).join(""));
    if (!options.dryRun) {
      appendToCleanupLog(reportLines);
    }
  } finally {
    releaseWatcherLock(cleanupLockFile());
  }
};

runWatcher().catch((failure: unknown) => {
  if (readConfig().debugLogs) {
    writeSync(2, `disk-cleanup error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
  process.exit(0);
});
