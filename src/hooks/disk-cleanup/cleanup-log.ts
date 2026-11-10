import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readCleanupLogFile } from "./cleanup-state.js";
import { reportTarget } from "./report-line.js";

// Weeks of passes, while the file stays small.
const LOG_LINE_LIMIT = 1_000;

const listLoggedLines = (logFile: string): ReadonlyArray<string> => {
  const isLogMissing = !existsSync(logFile);
  if (isLogMissing) {
    return [];
  }

  return readFileSync(logFile, "utf8").split("\n").filter(Boolean);
};

const stripTimestamp = (loggedLine: string): string => loggedLine.slice(loggedLine.indexOf(" ") + 1);

const readLastReportsByTarget = (loggedLines: ReadonlyArray<string>): Map<string, string> => {
  const lastReports = new Map<string, string>();
  for (const loggedLine of loggedLines) {
    const report = stripTimestamp(loggedLine);
    const target = reportTarget(report);

    const hasTarget = target != null;
    if (hasTarget) {
      lastReports.set(target, report);
    }
  }
  return lastReports;
};

// A pass that finds the same thing as the last one for a target, e.g. a worktree kept for the same reason, adds nothing.
const listReportsThatChanged = (request: {
  readonly reportLines: ReadonlyArray<string>;
  readonly earlierLines: ReadonlyArray<string>;
}): ReadonlyArray<string> => {
  const lastReports = readLastReportsByTarget(request.earlierLines);
  return request.reportLines.filter((report) => {
    const target = reportTarget(report);

    const isTargetMissing = target == null;
    if (isTargetMissing) {
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
  const logFile = readCleanupLogFile();
  const earlierLines = listLoggedLines(logFile);
  const changedReports = listReportsThatChanged({ reportLines, earlierLines });

  const isChangedReportsEmpty = changedReports.length === 0;
  if (isChangedReportsEmpty) {
    return;
  }

  const ranAt = new Date().toISOString();
  const newLines = changedReports.map((report) => `${ranAt} ${report}`);
  const keptLines = [...earlierLines, ...newLines].slice(-LOG_LINE_LIMIT);
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, `${keptLines.join("\n")}\n`);
};
