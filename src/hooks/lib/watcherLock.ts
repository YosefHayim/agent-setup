import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isProcessAlive } from "./processAlive.js";

const lockHolder = (lockFile: string): number => {
  try {
    return Number(readFileSync(lockFile, "utf8").trim());
  } catch {
    return 0;
  }
};

// The pid goes into this watcher's own file first and becomes the lock in one step, since a hard link fails when the
// lock exists, so no other watcher ever reads a lock whose pid is not written yet.
const createLock = (lockFile: string): boolean => {
  const pidFile = `${lockFile}.${process.pid}`;
  try {
    writeFileSync(pidFile, String(process.pid));
    linkSync(pidFile, lockFile);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(pidFile, { force: true });
  }
};

// One watcher of a feature acts at a time; a lock left by a dead watcher is taken over.
export const acquireWatcherLock = (lockFile: string): boolean => {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  if (createLock(lockFile)) {
    return true;
  }

  const holder = lockHolder(lockFile);
  if (holder === process.pid) {
    return true;
  }

  if (isProcessAlive(holder)) {
    return false;
  }

  rmSync(lockFile, { force: true });
  return createLock(lockFile);
};

// Reads the lock without taking it, so a waiting watcher can skip its own checks while another one has the turn.
export const isWatcherLockHeldByOther = (lockFile: string): boolean => {
  const holder = lockHolder(lockFile);
  return holder !== process.pid && isProcessAlive(holder);
};

export const releaseWatcherLock = (lockFile: string): void => {
  if (lockHolder(lockFile) === process.pid) {
    rmSync(lockFile, { force: true });
  }
};
