import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { listFinishedClaudeFolders } from "./finished-claude-folders.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const userId = process.getuid?.() ?? 0;
const homeRoots: Array<string> = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const homeRoot of homeRoots.splice(0)) {
    rmSync(homeRoot, { recursive: true, force: true });
  }
});

describe("listFinishedClaudeFolders", () => {
  it("lists done job tmp folders and scratch folders of sessions that are neither live nor in an unfinished job", () => {
    const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-finished-claude-folders-"));
    homeRoots.push(homeRoot);
    const configRoot = path.join(homeRoot, ".claude-account3");
    vi.stubEnv("CLAUDE_CONFIG_DIR", configRoot);
    vi.stubEnv("CLAUDE_CODE_TMPDIR", path.join(homeRoot, "tmp"));
    const projectFolder = path.join(homeRoot, "tmp", `claude-${userId}`, "project");
    for (const sessionId of ["dead-session", "live-session", "working-session"]) {
      mkdirSync(path.join(projectFolder, sessionId), { recursive: true });
    }
    writeFileSync(path.join(homeRoot, "tmp", `claude-${userId}`, "cache.json"), "{}");
    mkdirSync(path.join(configRoot, "sessions"), { recursive: true });
    writeFileSync(
      path.join(configRoot, "sessions", `${process.pid}.json`),
      JSON.stringify({ sessionId: "live-session", pid: process.pid }),
    );
    mkdirSync(path.join(configRoot, "jobs", "done-job"), { recursive: true });
    writeFileSync(path.join(configRoot, "jobs", "done-job", "state.json"), JSON.stringify({ state: "done" }));
    mkdirSync(path.join(configRoot, "jobs", "working-job"), { recursive: true });
    writeFileSync(
      path.join(configRoot, "jobs", "working-job", "state.json"),
      JSON.stringify({ state: "working", sessionId: "working-session" }),
    );

    const finishedFolders = listFinishedClaudeFolders(homeRoot);

    expect([...finishedFolders].sort()).toEqual([
      path.join(configRoot, "jobs", "done-job", "tmp"),
      path.join(projectFolder, "dead-session"),
    ]);
  });
});
