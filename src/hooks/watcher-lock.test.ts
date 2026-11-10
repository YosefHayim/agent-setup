import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireWatcherLock, isWatcherLockHeldByOther, releaseWatcherLock } from "./watcher-lock.js";

const DEAD_PID = 2_147_483_646;
const OTHER_LIVE_PID = String(process.ppid);
const storageFolders: Array<string> = [];

const readNewLockFile = (): string => {
  const storageFolder = mkdtempSync(path.join(tmpdir(), "scratch-watcher-lock-"));
  storageFolders.push(storageFolder);
  return path.join(storageFolder, "watcher.lock");
};

afterEach(() => {
  for (const storageFolder of storageFolders.splice(0)) {
    rmSync(storageFolder, { recursive: true, force: true });
  }
});

describe("acquireWatcherLock", () => {
  it("writes the pid with the lock and leaves no other file behind", () => {
    const lockFile = readNewLockFile();

    expect(acquireWatcherLock(lockFile)).toBe(true);
    expect(readFileSync(lockFile, "utf8")).toBe(String(process.pid));
    expect(readdirSync(path.dirname(lockFile))).toEqual(["watcher.lock"]);
    expect(acquireWatcherLock(lockFile)).toBe(true);
  });

  it("waits while a live watcher holds the lock", () => {
    const lockFile = readNewLockFile();
    writeFileSync(lockFile, OTHER_LIVE_PID);

    expect(acquireWatcherLock(lockFile)).toBe(false);
    releaseWatcherLock(lockFile);
    expect(readFileSync(lockFile, "utf8")).toBe(OTHER_LIVE_PID);
  });

  it("takes over a lock left by a dead watcher, and releases it", () => {
    const lockFile = readNewLockFile();
    writeFileSync(lockFile, String(DEAD_PID));

    expect(acquireWatcherLock(lockFile)).toBe(true);
    expect(readFileSync(lockFile, "utf8")).toBe(String(process.pid));
    releaseWatcherLock(lockFile);
    expect(existsSync(lockFile)).toBe(false);
  });
});

describe("isWatcherLockHeldByOther", () => {
  it("is true only while another live watcher holds the lock, and never takes it", () => {
    const lockFile = readNewLockFile();

    expect(isWatcherLockHeldByOther(lockFile)).toBe(false);
    writeFileSync(lockFile, OTHER_LIVE_PID);
    expect(isWatcherLockHeldByOther(lockFile)).toBe(true);
    writeFileSync(lockFile, String(DEAD_PID));
    expect(isWatcherLockHeldByOther(lockFile)).toBe(false);
    expect(readFileSync(lockFile, "utf8")).toBe(String(DEAD_PID));
    writeFileSync(lockFile, String(process.pid));
    expect(isWatcherLockHeldByOther(lockFile)).toBe(false);
  });
});
