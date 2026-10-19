import path from "node:path";

import { installRoot } from "../../lib/hookConfig.js";

const stateFolder = (): string =>
  process.env.AGENT_SETUP_DISK_CLEANUP_STATE_DIR || path.join(installRoot, "state", "disk-cleanup");

export const cleanupLockFile = (): string => path.join(stateFolder(), "watcher.lock");

export const cacheCleanupStampFile = (): string => path.join(stateFolder(), "last-cache-cleanup");

export const keptWorktreesFile = (): string => path.join(stateFolder(), "kept-worktrees");

export const cleanupLogFile = (): string => path.join(stateFolder(), "cleanup.log");
