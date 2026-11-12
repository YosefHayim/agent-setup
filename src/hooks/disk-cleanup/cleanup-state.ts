import path from "node:path";
import { readDiskCleanupStateFolder } from "../environment.js";
import { installRoot } from "../hook-config.js";

const readStorageFolder = (): string => readDiskCleanupStateFolder() ?? path.join(installRoot, "state", "disk-cleanup");

export const readCleanupLockFile = (): string => path.join(readStorageFolder(), "watcher.lock");

export const cacheCleanupStampFile = (): string => path.join(readStorageFolder(), "last-cache-cleanup");

export const readKeptWorktreesFile = (): string => path.join(readStorageFolder(), "kept-worktrees");

export const readCleanupLogFile = (): string => path.join(readStorageFolder(), "cleanup.log");

export const mergedWorktreeCleanupStampFile = (): string =>
  path.join(readStorageFolder(), "last-merged-worktree-cleanup");
