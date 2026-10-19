import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { keptWorktreesFile } from "./cleanupState.js";

// One worktree folder per line. A missing or unreadable file names none.
export const readKeptWorktrees = (): ReadonlyArray<string> => {
  const keptFile = keptWorktreesFile();
  try {
    return readFileSync(keptFile, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

export const saveKeptWorktrees = (folders: ReadonlyArray<string>): void => {
  const keptFile = keptWorktreesFile();
  const keptLines = folders.map((folder) => `${folder}\n`);
  mkdirSync(path.dirname(keptFile), { recursive: true });
  writeFileSync(keptFile, keptLines.join(""));
};
