import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./processKillGuard.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const sessionId = "40a92360-e5fd-4ac2-a99d-b569f510c890";
const workspaces: Array<string> = [];
const standIns: Array<ChildProcess> = [];

// Stands in for a Claude Code session started by cmux, whose --settings argument mentions "notifications".
const startSessionStandIn = async (): Promise<ChildProcess> => {
  const standIn = spawn(process.execPath, [
    "-e",
    "console.log('ready'); setTimeout(() => {}, 60000)",
    "--",
    "--settings",
    '{"preferredNotifChannel":"notifications_disabled"}',
  ]);
  standIns.push(standIn);
  await once(standIn.stdout, "data");
  return standIn;
};

const createHomeWithSession = (processId: number): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-process-kill-guard-"));
  workspaces.push(homeRoot);
  const registryFolder = path.join(homeRoot, ".claude", "sessions");
  mkdirSync(registryFolder, { recursive: true });
  writeFileSync(path.join(registryFolder, `${processId}.json`), JSON.stringify({ sessionId, pid: processId }));
  return homeRoot;
};

const runHook = (hookInput: string, homeRoot: string) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    input: hookInput,
    encoding: "utf8",
    env: { ...process.env, HOME: homeRoot, CLAUDE_CONFIG_DIR: path.join(homeRoot, ".claude") },
  });

const bashCall = (command: string): string => JSON.stringify({ tool_name: "Bash", tool_input: { command } });

afterEach(() => {
  for (const standIn of standIns.splice(0)) {
    standIn.kill();
  }
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("processKillGuard process boundary", () => {
  it("fails open with clean stdout when hook input is malformed", () => {
    const homeRoot = createHomeWithSession(process.pid);

    const execution = runHook("{", homeRoot);

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe("");
  });

  it("denies pkill -f cat while a running Claude Code session's command line holds the word notifications", async () => {
    const standIn = await startSessionStandIn();
    const homeRoot = createHomeWithSession(Number(standIn.pid));

    const execution = runHook(bashCall('pkill -f "cat" 2>/dev/null; git status --short'), homeRoot);

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    expect(JSON.parse(execution.stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
    expect(execution.stdout).toContain(`pid ${standIn.pid}`);
  });

  it("allows pkill -f wrangler, which only matches the dev servers the agent started", async () => {
    const standIn = await startSessionStandIn();
    const homeRoot = createHomeWithSession(Number(standIn.pid));

    const execution = runHook(bashCall("pkill -f wrangler"), homeRoot);

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });
});
