import { realpathSync } from "node:fs";

// lsof names each open file by its real path, whatever symlink led to it.
export const realFolder = (folder: string): string => {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
};

// git keeps the path a worktree was made at, which runs through a symlink once a folder on it is moved and linked
// back, so a folder goes by the path it was found at and by its real path.
export const folderPaths = (folder: string): ReadonlyArray<string> => {
  const realPath = realFolder(folder);
  return [...new Set([folder, realPath])];
};
