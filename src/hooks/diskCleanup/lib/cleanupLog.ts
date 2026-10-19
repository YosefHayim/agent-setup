import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cleanupLogFile } from "./cleanupState.js";

// Weeks of passes, while the file stays small.
const LOG_LINE_LIMIT = 1_000;

const loggedLines = (logFile: string): ReadonlyArray<string> => {
  if (!existsSync(logFile)) {
    return [];
  }

  return readFileSync(logFile, "utf8").split("\n").filter(Boolean);
};

// The watcher runs detached with nowhere to print, so this file is the only record of what a pass did. Each line
// starts with when the pass ran, and only the latest lines stay.
export const appendToCleanupLog = (reportLines: ReadonlyArray<string>): void => {
  if (reportLines.length === 0) {
    return;
  }

  const logFile = cleanupLogFile();
  const ranAt = new Date().toISOString();
  const earlierLines = loggedLines(logFile);
  const newLines = reportLines.map((line) => `${ranAt} ${line}`);
  const keptLines = [...earlierLines, ...newLines].slice(-LOG_LINE_LIMIT);
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, `${keptLines.join("\n")}\n`);
};
