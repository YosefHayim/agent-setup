import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { unsavedWorkTrees } from "./unsaved-git-work.js";

const removeAround = (request: { readonly folder: string; readonly keptWorkTrees: ReadonlyArray<string> }): void => {
  const entries = readdirSync(request.folder).map((name) => path.join(request.folder, name));
  const entriesAroundKeptWork = entries.filter((entry) =>
    request.keptWorkTrees.some((workTree) => workTree.startsWith(`${entry}${path.sep}`)),
  );
  const removableEntries = entries.filter(
    (entry) => !entriesAroundKeptWork.includes(entry) && !request.keptWorkTrees.includes(entry),
  );
  for (const entry of removableEntries) {
    rmSync(entry, { recursive: true, force: true });
  }
  for (const entry of entriesAroundKeptWork) {
    removeAround({ folder: entry, keptWorkTrees: request.keptWorkTrees });
  }
};

// Deletes everything inside a scratch folder except git work trees holding work that is not committed and pushed,
// and returns the work trees it kept.
export const emptyScratchFolder = (folder: string): ReadonlyArray<string> => {
  const keptWorkTrees = unsavedWorkTrees(folder);
  if (!keptWorkTrees.includes(folder)) {
    removeAround({ folder, keptWorkTrees });
  }
  return keptWorkTrees;
};

const removeScratchFolder = (folder: string): void => {
  const keptWorkTrees = emptyScratchFolder(folder);
  if (keptWorkTrees.length === 0) {
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
