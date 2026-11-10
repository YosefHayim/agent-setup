import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { LeftoverProcess } from "./leftover-process-decision.js";

export const readLeftoverStorageFolder = (): string => path.join(os.homedir(), ".local", "state", "agent-setup");

export const writeStoppedProcesses = (stoppedProcesses: ReadonlyArray<LeftoverProcess>): void => {
  const logFile = path.join(readLeftoverStorageFolder(), "leftover-process-cleanup.log");
  const stoppedAt = new Date().toISOString();
  const lines = stoppedProcesses.map(
    (stopped) =>
      `${stoppedAt} stopped pid=${stopped.processId} name=${JSON.stringify(stopped.name)} reason=${stopped.reason}\n`,
  );
  mkdirSync(path.dirname(logFile), { recursive: true });
  appendFileSync(logFile, lines.join(""));
};
