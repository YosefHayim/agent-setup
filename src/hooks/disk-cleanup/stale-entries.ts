import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { reportLine } from "./report-line.js";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
// Two weeks without a touch: long enough to cover a holiday, short enough that caches never pile up.
const STALE_AFTER_DAYS = 14;

export const listChildNames = (folder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(folder).map((name) => path.join(folder, name));
  } catch {
    return [];
  }
};

const isUntouchedForDays = (request: { readonly entry: string; readonly days: number }): boolean => {
  try {
    return Date.now() - statSync(request.entry).mtimeMs > request.days * DAY_MILLISECONDS;
  } catch {
    return false;
  }
};

export const isStale = (line: string): boolean => isUntouchedForDays({ entry: line, days: STALE_AFTER_DAYS });

const deleteLine = (line: string): string => {
  try {
    rmSync(line, { recursive: true, force: true });
    return reportLine({ action: "deleted", detail: "stale cache", target: line });
  } catch {
    return reportLine({ action: "kept", detail: "delete failed", target: line });
  }
};

export const deleteLines = (request: {
  readonly entries: ReadonlyArray<string>;
  readonly dryRun: boolean;
}): ReadonlyArray<string> => {
  const isDryRun = request.dryRun;
  if (isDryRun) {
    return request.entries.map((line) => reportLine({ action: "would delete", detail: "stale cache", target: line }));
  }

  return request.entries.map(deleteLine);
};
