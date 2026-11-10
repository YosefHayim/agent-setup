import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

import { isNotFound } from "./file-bytes.js";
import { isInsideFolder } from "./recovery.js";

interface ExistingEntry {
  readonly root: string;
  readonly targetPath: string;
  readonly existingPath: string;
  readonly realPath: string;
}

const createRealPathError = (description: string): Error => new Error(`FileSystem.realPath: ${description}`);

const realPathOrNull = async (filePath: string): Promise<string | null> => {
  try {
    return await realpath(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }

    throw error;
  }
};

export const validatePlanRoot = async (root: string): Promise<string> => {
  const normalizedRoot = normalize(root);
  const isRootNotCanonical = !isAbsolute(root) || resolve(root) !== normalizedRoot;
  if (isRootNotCanonical) {
    throw createRealPathError(`Plan root ${root} is not a fully qualified canonical path on this host.`);
  }

  const realRoot = await realpath(normalizedRoot);
  const rootStats = await stat(realRoot);

  const isRootNotDirectory = !rootStats.isDirectory();
  if (isRootNotDirectory) {
    throw createRealPathError(`Plan root ${root} is not a directory.`);
  }

  return realRoot;
};

const validateExistingEntry = async (entry: ExistingEntry): Promise<void> => {
  const expectedRealPath = resolve(entry.root, relative(entry.root, entry.existingPath));
  const existingStats = await stat(entry.existingPath);
  const isTargetItself = entry.existingPath === entry.targetPath;
  const isExpectedKind = isTargetItself ? existingStats.isFile() : existingStats.isDirectory();
  const isPathRedirected = entry.realPath !== expectedRealPath || !isExpectedKind;
  if (isPathRedirected) {
    throw createRealPathError(
      `Transaction target ${entry.targetPath} has a symlinked or non-file path component at ${entry.existingPath}.`,
    );
  }
};

// Walks up to the nearest existing path so a symlinked ancestor cannot redirect a later write outside the root.
const validateNearestExistingPath = async (root: string, targetPath: string, existingPath: string): Promise<void> => {
  const realPath = await realPathOrNull(existingPath);
  const isExistingPathFound = realPath !== null;
  if (isExistingPathFound) {
    return validateExistingEntry({ root, targetPath, existingPath, realPath });
  }

  const parentPath = dirname(existingPath);
  const isFilesystemTopReached = parentPath === existingPath;
  if (isFilesystemTopReached) {
    throw createRealPathError(`Transaction target ${targetPath} is outside installation root ${root}.`);
  }

  return validateNearestExistingPath(root, targetPath, parentPath);
};

export const validateTarget = async (root: string, targetPath: string): Promise<void> => {
  const realRoot = await realpath(root);
  const isRootMoved = realRoot !== root || !isInsideFolder(root, targetPath);
  if (isRootMoved) {
    throw createRealPathError(`Transaction target ${targetPath} is outside its captured installation root.`);
  }

  return validateNearestExistingPath(root, targetPath, targetPath);
};

// Directories between the root and the target, outermost first; empty when the target is not below the root.
export const parentDirectories = (root: string, targetPath: string): Array<string> => {
  const directories: Array<string> = [];
  let directory = dirname(targetPath);
  while (directory !== root) {
    const relativeDirectory = relative(root, directory);
    const isOutsideRoot = relativeDirectory.startsWith("..") || isAbsolute(relativeDirectory);
    if (isOutsideRoot) {
      return [];
    }

    directories.push(directory);
    const parentDirectory = dirname(directory);
    const isFilesystemTopReached = parentDirectory === directory;
    if (isFilesystemTopReached) {
      return [];
    }

    directory = parentDirectory;
  }

  return directories.reverse();
};
