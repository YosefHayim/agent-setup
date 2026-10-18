import { realpathSync } from "node:fs";

export type FolderPaths = { readonly folder: string; readonly paths: ReadonlyArray<string> };

// lsof names each open file by its real path, whatever symlink led to it.
export const realFolder = (folder: string): string => {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
};

const pathThroughRoot = (request: { readonly realPath: string; readonly root: string }): ReadonlyArray<string> => {
  const realRoot = realFolder(request.root);
  const isUnderRoot = request.realPath.startsWith(`${realRoot}/`);
  return isUnderRoot ? [`${request.root}${request.realPath.slice(realRoot.length)}`] : [];
};

// git keeps the path a worktree was made at, which runs through a symlink once a folder on it is moved and linked
// back, and names one made under a linked root by its real path, which sessions can still reach through the root. So
// a folder goes by the path it was found at, its real path, and its path through each root that leads to it.
export const folderPaths = (request: {
  readonly folder: string;
  readonly roots: ReadonlyArray<string>;
}): FolderPaths => {
  const realPath = realFolder(request.folder);
  const rootPaths = request.roots.flatMap((root) => pathThroughRoot({ realPath, root }));
  return { folder: request.folder, paths: [...new Set([request.folder, realPath, ...rootPaths])] };
};
