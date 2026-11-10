import { realpathSync } from "node:fs";
import path from "node:path";

export type FolderPaths = { readonly folder: string; readonly paths: ReadonlyArray<string> };

// Only the top folder "/" already ends in the separator that starts every path inside a folder.
const isInsideFolder = (request: { readonly candidate: string; readonly folder: string }): boolean => {
  const isFolderWithSlash = request.folder.endsWith("/");
  const insideStart = isFolderWithSlash ? request.folder : `${request.folder}/`;
  return request.candidate === request.folder || request.candidate.startsWith(insideStart);
};

export const isInsideAnyFolder = (request: {
  readonly candidate: string;
  readonly folders: ReadonlyArray<string>;
}): boolean => request.folders.some((folder) => isInsideFolder({ candidate: request.candidate, folder }));

// lsof names each open file by its real path, whatever symlink led to it.
export const readRealFolder = (folder: string): string => {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
};

const listPathThroughRoot = (request: { readonly realPath: string; readonly root: string }): ReadonlyArray<string> => {
  const realRoot = readRealFolder(request.root);
  const insidePath = path.relative(realRoot, request.realPath);
  const isUnderRoot = isInsideFolder({ candidate: request.realPath, folder: realRoot });
  return isUnderRoot ? [path.join(request.root, insidePath)] : [];
};

// git keeps the path a worktree was made at, which runs through a symlink once a folder on it is moved and linked
// back, and names one made under a linked root by its real path, which sessions can still reach through the root. So
// a folder goes by the path it was found at, its real path, and its path through each root that leads to it.
export const readFolderPaths = (request: {
  readonly folder: string;
  readonly roots: ReadonlyArray<string>;
}): FolderPaths => {
  const realPath = readRealFolder(request.folder);
  const rootPaths = request.roots.flatMap((root) => listPathThroughRoot({ realPath, root }));
  return { folder: request.folder, paths: [...new Set([request.folder, realPath, ...rootPaths])] };
};
