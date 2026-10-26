import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cleanupLogFile } from "./cleanupState.js";
import { reportTarget } from "./reportLine.js";

// Weeks of passes, while the file stays small.
const LOG_LINE_LIMIT = 1_000;

const loggedLines = (logFile: string): ReadonlyArray<string> => {
  if (!existsSync(logFile)) {
    return [];
  }

  return readFileSync(logFile, "utf8").split("\n").filter(Boolean);
};

const withoutTimestamp = (loggedLine: string): string => loggedLine.slice(loggedLine.indexOf(" ") + 1);

const lastReportsByTarget = (loggedLines: ReadonlyArray<string>): Map<string, string> => {
  const lastReports = new Map<string, string>();
  for (const loggedLine of loggedLines) {
    const report = withoutTimestamp(loggedLine);
    const target = reportTarget(report);
    if (target !== undefined) {
      lastReports.set(target, report);
    }
  }
  return lastReports;
};

// A pass that finds the same thing as the last one for a target, e.g. a worktree kept for the same reason, adds nothing.
const reportsThatChanged = (request: {
  readonly reportLines: ReadonlyArray<string>;
  readonly earlierLines: ReadonlyArray<string>;
}): ReadonlyArray<string> => {
  const lastReports = lastReportsByTarget(request.earlierLines);
  return request.reportLines.filter((report) => {
    const target = reportTarget(report);
    if (target === undefined) {
      return true;
    }

    const isRepeat = lastReports.get(target) === report;
    lastReports.set(target, report);
    return !isRepeat;
  });
};

// The watcher runs detached with nowhere to print, so this file is the only record of what a pass did. Each line
// starts with when the pass ran, and only the latest lines stay.
export const appendToCleanupLog = (reportLines: ReadonlyArray<string>): void => {
  const logFile = cleanupLogFile();
  const earlierLines = loggedLines(logFile);
  const changedReports = reportsThatChanged({ reportLines, earlierLines });
  if (changedReports.length === 0) {
    return;
  }

  const ranAt = new Date().toISOString();
  const newLines = changedReports.map((report) => `${ranAt} ${report}`);
  const keptLines = [...earlierLines, ...newLines].slice(-LOG_LINE_LIMIT);
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, `${keptLines.join("\n")}\n`);
};
