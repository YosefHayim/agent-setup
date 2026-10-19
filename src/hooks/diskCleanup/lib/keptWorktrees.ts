import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { keptWorktreesFile } from "./cleanupState.js";
import type { LinkedWorktree } from "./linkedWorktrees.js";

// e.g. "login\t/Users/me/Code/app/.worktrees/login". The branch tells the kept worktree from one made later in the same
// folder for other work.
export const keptWorktreeLine = (worktree: LinkedWorktree): string => `${worktree.branch}\t${worktree.folder}`;

const folderOf = (keptLine: string): string => keptLine.slice(keptLine.indexOf("\t") + 1);

// A missing file names no worktree, while one that cannot be read gives no answer.
export const readKeptWorktrees = (): ReadonlyArray<string> | undefined => {
  const keptFile = keptWorktreesFile();
  if (!existsSync(keptFile)) {
    return [];
  }

  try {
    return readFileSync(keptFile, "utf8").split("\n").filter(Boolean);
  } catch {
    return undefined;
  }
};

// Whatever the pass looked at and is still there was kept. One kept earlier whose repo could not be listed this time
// stays while its folder does, and a list that could not be read is not saved over.
export const saveKeptWorktrees = (request: {
  readonly lookedAtWorktrees: ReadonlyArray<LinkedWorktree>;
  readonly listedFolders: ReadonlyArray<string>;
  readonly earlierKeptLines: ReadonlyArray<string> | undefined;
}): void => {
  if (!request.earlierKeptLines) {
    return;
  }

  const unlistedLines = request.earlierKeptLines.filter((keptLine) => {
    const folder = folderOf(keptLine);
    return !request.listedFolders.includes(folder);
  });
  const lookedAtLines = request.lookedAtWorktrees.map(keptWorktreeLine);
  const keptLines = [...unlistedLines, ...lookedAtLines].filter((keptLine) => {
    const folder = folderOf(keptLine);
    return existsSync(folder);
  });
  const keptFile = keptWorktreesFile();
  mkdirSync(path.dirname(keptFile), { recursive: true });
  writeFileSync(keptFile, keptLines.map((keptLine) => `${keptLine}\n`).join(""));
};
