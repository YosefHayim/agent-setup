import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { liveClaudeSessionIds } from "./claudeLiveSessions.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runningSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const exitedSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const secondAccountSessionId = "0c2d6c1e-7f0a-4a55-9d0e-3a1b8f2c4d77";
const workspaces: Array<string> = [];

const createHomeRoot = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-live-sessions-"));
  workspaces.push(homeRoot);
  return homeRoot;
};

const registerSession = (request: {
  readonly configRoot: string;
  readonly sessionId: string;
  readonly processId: number;
}) => {
  const registryFolder = path.join(request.configRoot, "sessions");
  mkdirSync(registryFolder, { recursive: true });
  writeFileSync(
    path.join(registryFolder, `${request.processId}.json`),
    JSON.stringify({ sessionId: request.sessionId, pid: request.processId }),
  );
};

const exitedProcessId = (): number => {
  const exitedProcess = spawnSync(process.execPath, ["-e", ""]);
  return exitedProcess.pid;
};

// A folder that links to itself cannot be listed even by root, which ignores file modes.
const linkToItself = (folder: string) => {
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(folder, folder);
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("liveClaudeSessionIds", () => {
  it("lists the session a running process holds and skips one whose process exited", () => {
    const homeRoot = createHomeRoot();
    const configRoot = path.join(homeRoot, ".claude");
    registerSession({ configRoot, sessionId: runningSessionId, processId: process.pid });
    registerSession({ configRoot, sessionId: exitedSessionId, processId: exitedProcessId() });

    const liveSessionIds = liveClaudeSessionIds(homeRoot);

    expect(liveSessionIds.has(runningSessionId)).toBe(true);
    expect(liveSessionIds.has(exitedSessionId)).toBe(false);
  });

  it("reads the registry of a second account beside ~/.claude", () => {
    const homeRoot = createHomeRoot();
    registerSession({
      configRoot: path.join(homeRoot, ".claude-work"),
      sessionId: secondAccountSessionId,
      processId: process.pid,
    });

    expect(liveClaudeSessionIds(homeRoot).has(secondAccountSessionId)).toBe(true);
  });

  it("skips a registry entry that is not a session", () => {
    const homeRoot = createHomeRoot();
    const registryFolder = path.join(homeRoot, ".claude", "sessions");
    mkdirSync(registryFolder, { recursive: true });
    writeFileSync(path.join(registryFolder, "1.json"), "{");
    writeFileSync(path.join(registryFolder, "2.json"), JSON.stringify({ pid: process.pid }));

    expect(liveClaudeSessionIds(homeRoot).has(runningSessionId)).toBe(false);
  });

  it("reads a config root that never ran a session as holding none", () => {
    const homeRoot = createHomeRoot();
    mkdirSync(path.join(homeRoot, ".claude"));
    registerSession({
      configRoot: path.join(homeRoot, ".claude-work"),
      sessionId: secondAccountSessionId,
      processId: process.pid,
    });

    expect(liveClaudeSessionIds(homeRoot).has(secondAccountSessionId)).toBe(true);
  });

  it("fails while a registry folder cannot be listed, since any session could be running", () => {
    const homeRoot = createHomeRoot();
    linkToItself(path.join(homeRoot, ".claude", "sessions"));

    expect(() => liveClaudeSessionIds(homeRoot)).toThrow();
  });
});
