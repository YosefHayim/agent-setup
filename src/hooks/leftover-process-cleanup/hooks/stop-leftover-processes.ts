#!/usr/bin/env node
import { existsSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLiveClaudeProcessIds } from "../../claude-live-sessions.js";
import { listCodeRootFolders } from "../../code-repos.js";
import { readLeftoverBrowserMinimumAgeSeconds } from "../../environment.js";
import { readFailureText } from "../../failure-text.js";
import { readSettings } from "../../hook-config.js";
import { claimIntervalSlot } from "../../interval-stamp.js";
import { listRunningProcesses } from "../../process-table.js";
import { decideLeftoverProcesses, isNeverStopped, readAncestorProcessIds } from "../leftover-process-decision.js";
import { readLeftoverStorageFolder, writeStoppedProcesses } from "../leftover-process-log.js";
import { stopProcesses } from "../stop-processes.js";
import { listWorkingFolders } from "../working-folders.js";

// Stop and SubagentStop fire every turn; a look a few seconds ago already covers the processes that are left.
const SCAN_MINIMUM_INTERVAL_SECONDS = 20;
const ONE_HOUR_SECONDS = 3_600;

const readTestBrowserMinimumAgeSeconds = (): number => {
  const configuredString = readLeftoverBrowserMinimumAgeSeconds();
  const configuredSeconds = Number(configuredString);
  const isConfigured = configuredString != null && Number.isFinite(configuredSeconds) && configuredSeconds >= 0;
  return isConfigured ? configuredSeconds : ONE_HOUR_SECONDS;
};

const stopLeftoverProcesses = async (): Promise<void> => {
  const homeRoot = os.homedir();
  const stampFile = path.join(readLeftoverStorageFolder(), "leftover-process-cleanup.stamp");

  const isNotScanDue = !claimIntervalSlot({ stampFile, minimumSeconds: SCAN_MINIMUM_INTERVAL_SECONDS });
  if (isNotScanDue) {
    return;
  }

  const processes = listRunningProcesses();
  const protectedProcessIds = new Set([
    ...readLiveClaudeProcessIds(homeRoot),
    ...readAncestorProcessIds({ processes, startProcessId: process.pid }),
  ]);
  const lookableProcessIds = processes
    .filter((runningProcess) => !isNeverStopped({ runningProcess, protectedProcessIds }))
    .map((runningProcess) => runningProcess.processId);
  const workingFolders = listWorkingFolders(lookableProcessIds);
  const missingFolders = new Set([...workingFolders.values()].filter((folder) => !existsSync(folder)));
  const codeRoots = listCodeRootFolders({ homeRoot, rootFolders: readSettings().diskCleanupRoots });
  const leftoverProcesses = decideLeftoverProcesses({
    processes,
    protectedProcessIds,
    workingFolders,
    missingFolders,
    codeRoots,
    testBrowserMinimumAgeSeconds: readTestBrowserMinimumAgeSeconds(),
  });

  const hasNothingToStop = leftoverProcesses.length === 0;
  if (hasNothingToStop) {
    return;
  }

  await stopProcesses(leftoverProcesses.map((leftover) => leftover.processId));
  writeStoppedProcesses(leftoverProcesses);
};

try {
  await stopLeftoverProcesses();
} catch (failure) {
  const isDebugLogging = readSettings().debugLogs;
  if (isDebugLogging) {
    writeSync(2, `leftover-process-cleanup error: ${readFailureText(failure)}\n`);
  }
}
process.exit(0);
