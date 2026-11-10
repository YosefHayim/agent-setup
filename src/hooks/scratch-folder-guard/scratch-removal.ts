import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { listUnsavedWorkTrees } from "./unsaved-git-work.js";

const removeAround = (request: { readonly folder: string; readonly keptWorkTrees: ReadonlyArray<string> }): void => {
  const lines = readdirSync(request.folder).map((name) => path.join(request.folder, name));
  const linesAroundKeptWork = lines.filter((line) =>
    request.keptWorkTrees.some((workTree) => workTree.startsWith(`${line}${path.sep}`)),
  );
  const removableLines = lines.filter(
    (line) => !linesAroundKeptWork.includes(line) && !request.keptWorkTrees.includes(line),
  );
  for (const line of removableLines) {
    rmSync(line, { recursive: true, force: true });
  }
  for (const line of linesAroundKeptWork) {
    removeAround({ folder: line, keptWorkTrees: request.keptWorkTrees });
  }
};

// Deletes everything inside a scratch folder except git work trees holding work that is not committed and pushed,
// and returns the work trees it kept.
export const listEmptyScratchFolder = (folder: string): ReadonlyArray<string> => {
  const keptWorkTrees = listUnsavedWorkTrees(folder);

  const isNotKeptWorkTree = !keptWorkTrees.includes(folder);
  if (isNotKeptWorkTree) {
    removeAround({ folder, keptWorkTrees });
  }

  return keptWorkTrees;
};

const removeScratchFolder = (folder: string): void => {
  const keptWorkTrees = listEmptyScratchFolder(folder);

  const isKeptWorkTreesEmpty = keptWorkTrees.length === 0;
  if (isKeptWorkTreesEmpty) {
    rmSync(folder, { recursive: true, force: true });
  }
};

export const removeScratchFolders = (folders: ReadonlyArray<string>): void => {
  for (const folder of folders) {
    try {
      removeScratchFolder(folder);
    } catch {
      // One folder that cannot be removed, such as a read-only module cache, must not keep the others.
    }
  }
};
