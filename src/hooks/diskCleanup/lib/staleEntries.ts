import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { reportLine } from "./reportLine.js";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
// Two weeks without a touch: long enough to cover a holiday, short enough that caches never pile up.
const STALE_AFTER_DAYS = 14;

export const childEntries = (folder: string): ReadonlyArray<string> => {
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

export const isStale = (entry: string): boolean => isUntouchedForDays({ entry, days: STALE_AFTER_DAYS });

const deleteEntry = (entry: string): string => {
  try {
    rmSync(entry, { recursive: true, force: true });
    return reportLine({ action: "deleted", detail: "stale cache", target: entry });
  } catch {
    return reportLine({ action: "kept", detail: "delete failed", target: entry });
  }
};

export const deleteEntries = (request: {
  readonly entries: ReadonlyArray<string>;
  readonly dryRun: boolean;
}): ReadonlyArray<string> => {
  if (request.dryRun) {
    return request.entries.map((entry) => reportLine({ action: "would delete", detail: "stale cache", target: entry }));
  }

  return request.entries.map(deleteEntry);
};
