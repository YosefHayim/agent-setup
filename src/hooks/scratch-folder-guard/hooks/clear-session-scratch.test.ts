import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./clear-session-scratch.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(hookPath), "../../../..");
const endedSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const liveSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const workspaces: Array<string> = [];

const createHomeRoot = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-session-hook-"));
  workspaces.push(homeRoot);
  return homeRoot;
};

const readSessionFolder = (request: { readonly homeRoot: string; readonly sessionId: string }) =>
  path.join(request.homeRoot, "claude-scratch", `claude-${process.getuid?.()}`, "-Users-me-repo", request.sessionId);

const createSessionFolder = (request: { readonly homeRoot: string; readonly sessionId: string }) => {
  const scratchpad = path.join(readSessionFolder(request), "scratchpad");
  mkdirSync(scratchpad, { recursive: true });
  writeFileSync(path.join(scratchpad, "notes.txt"), "scratch");
};

// The watcher the hook starts sweeps every scratch root it can find, so each one is pointed inside the workspace.
const runHook = (request: { readonly homeRoot: string; readonly hookInput: string }) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    cwd: packageRoot,
    input: request.hookInput,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: request.homeRoot,
      CLAUDE_CONFIG_DIR: path.join(request.homeRoot, ".claude"),
      CLAUDE_CODE_TMPDIR: path.join(request.homeRoot, "claude-scratch"),
      CODEX_HOME: path.join(request.homeRoot, ".codex"),
    },
  });

const waitUntilRemoved = async (folder: string) => {
  for (let attempt = 0; attempt < 40 && existsSync(folder); attempt += 1) {
    await new Promise((fulfill) => setTimeout(fulfill, 250));
  }
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("clearSessionScratch process boundary", () => {
  it("hands the ended session to the watcher, which deletes only that session's scratch folder", async () => {
    const homeRoot = createHomeRoot();
    createSessionFolder({ homeRoot, sessionId: endedSessionId });
    createSessionFolder({ homeRoot, sessionId: liveSessionId });

    const execution = runHook({ homeRoot, hookInput: JSON.stringify({ session_id: endedSessionId }) });
    await waitUntilRemoved(readSessionFolder({ homeRoot, sessionId: endedSessionId }));

    expect(execution.status).toBe(0);
    expect(existsSync(readSessionFolder({ homeRoot, sessionId: endedSessionId }))).toBe(false);
    expect(existsSync(readSessionFolder({ homeRoot, sessionId: liveSessionId }))).toBe(true);
  });

  it("starts no watcher for a session ID that is not a UUID", async () => {
    const homeRoot = createHomeRoot();
    createSessionFolder({ homeRoot, sessionId: endedSessionId });

    const execution = runHook({ homeRoot, hookInput: JSON.stringify({ session_id: ".." }) });
    await new Promise((fulfill) => setTimeout(fulfill, 1_500));

    expect(execution.status).toBe(0);
    expect(existsSync(readSessionFolder({ homeRoot, sessionId: endedSessionId }))).toBe(true);
  });

  it("fails open on malformed input", () => {
    const execution = runHook({ homeRoot: createHomeRoot(), hookInput: "{" });

    expect(execution.status).toBe(0);
  });
});
