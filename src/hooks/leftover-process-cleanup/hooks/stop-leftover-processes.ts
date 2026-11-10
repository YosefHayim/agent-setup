#!/usr/bin/env node
import { existsSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { liveClaudeProcessIds } from "../../claude-live-sessions.js";
import { codeRootFolders } from "../../code-repos.js";
import { readConfig } from "../../hook-config.js";
import { claimIntervalSlot } from "../../interval-stamp.js";
import { runningProcesses } from "../../process-table.js";
import { ancestorProcessIds, decideLeftoverProcesses, isNeverStopped } from "../leftover-process-decision.js";
import { leftoverStateFolder, writeStoppedProcesses } from "../leftover-process-log.js";
import { stopProcesses } from "../stop-processes.js";
import { listWorkingFolders } from "../working-folders.js";

// Stop and SubagentStop fire every turn; a look a few seconds ago already covers the processes that are left.
const SCAN_MINIMUM_INTERVAL_SECONDS = 20;
const ONE_HOUR_SECONDS = 3_600;

const testBrowserMinimumAgeSeconds = (): number => {
  const configuredText = process.env.AGENT_SETUP_LEFTOVER_PROCESS_CLEANUP_BROWSER_MINIMUM_AGE_SECONDS;
  const configuredSeconds = Number(configuredText);
  const isConfigured = configuredText !== undefined && Number.isFinite(configuredSeconds) && configuredSeconds >= 0;
  return isConfigured ? configuredSeconds : ONE_HOUR_SECONDS;
};

const stopLeftoverProcesses = async (): Promise<void> => {
  const homeRoot = os.homedir();
  const stampFile = path.join(leftoverStateFolder(), "leftover-process-cleanup.stamp");
  const isScanDue = claimIntervalSlot({ stampFile, minimumSeconds: SCAN_MINIMUM_INTERVAL_SECONDS });
  if (!isScanDue) {
    return;
  }

  const processes = runningProcesses();
  const protectedProcessIds = new Set([
    ...liveClaudeProcessIds(homeRoot),
    ...ancestorProcessIds({ processes, startProcessId: process.pid }),
  ]);
  const lookableProcessIds = processes
    .filter((runningProcess) => !isNeverStopped({ runningProcess, protectedProcessIds }))
    .map((runningProcess) => runningProcess.processId);
  const workingFolders = listWorkingFolders(lookableProcessIds);
  const missingFolders = new Set([...workingFolders.values()].filter((folder) => !existsSync(folder)));
  const codeRoots = codeRootFolders({ homeRoot, rootFolders: readConfig().diskCleanupRoots });
  const leftoverProcesses = decideLeftoverProcesses({
    processes,
    protectedProcessIds,
    workingFolders,
    missingFolders,
    codeRoots,
    testBrowserMinimumAgeSeconds: testBrowserMinimumAgeSeconds(),
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
  if (readConfig().debugLogs) {
    writeSync(2, `leftover-process-cleanup error: ${failure instanceof Error ? failure.stack : String(failure)}\n`);
  }
}
process.exit(0);
