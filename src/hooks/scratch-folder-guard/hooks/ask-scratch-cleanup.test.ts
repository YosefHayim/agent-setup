import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./ask-scratch-cleanup.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(hookPath), "../../../..");
const sessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const threadId = "01a0e4bf-1e83-7532-9119-d78525246a31";
const workspaces: Array<string> = [];

const createHomeRoot = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-cleanup-question-"));
  workspaces.push(homeRoot);
  return homeRoot;
};

const readClaudeSessionFolder = (homeRoot: string) =>
  path.join(homeRoot, "claude-scratch", `claude-${process.getuid?.()}`, "-Users-me-repo", sessionId);

const readCodexThreadFolder = (homeRoot: string) => path.join(homeRoot, ".codex", "scratchpad", threadId);

const writeScratchFile = (folder: string) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "probe.log"), "log\n");
};

const writeRollout = (request: { readonly homeRoot: string; readonly source: unknown }): string => {
  const rolloutFile = path.join(request.homeRoot, ".codex", "sessions", `rollout-${threadId}.jsonl`);
  mkdirSync(path.dirname(rolloutFile), { recursive: true });
  const threadHeader = { type: "session_meta", payload: { id: threadId, source: request.source } };
  writeFileSync(rolloutFile, `${JSON.stringify(threadHeader)}\n${JSON.stringify({ type: "event_msg" })}\n`);
  return rolloutFile;
};

const runHook = (request: {
  readonly homeRoot: string;
  readonly agentId: string;
  readonly attendedFlag: string;
  readonly hookInput: string;
}) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    input: request.hookInput,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: request.homeRoot,
      CLAUDE_CONFIG_DIR: path.join(request.homeRoot, ".claude"),
      CLAUDE_CODE_TMPDIR: path.join(request.homeRoot, "claude-scratch"),
      CODEX_HOME: path.join(request.homeRoot, ".codex"),
      AGENT_SETUP_AGENT_ID: request.agentId,
      CLAUDE_CODE_SESSION_ATTENDED: request.attendedFlag,
    },
  });

const runClaudeHook = (request: { readonly homeRoot: string; readonly stopInput: Record<string, unknown> }) =>
  runHook({
    homeRoot: request.homeRoot,
    agentId: "claude-code",
    attendedFlag: "1",
    hookInput: JSON.stringify({ session_id: sessionId, hook_event_name: "Stop", ...request.stopInput }),
  });

const runCodexHook = (request: { readonly homeRoot: string; readonly rolloutFile: string | null }) =>
  runHook({
    homeRoot: request.homeRoot,
    agentId: "codex",
    attendedFlag: "1",
    hookInput: JSON.stringify({
      session_id: threadId,
      transcript_path: request.rolloutFile,
      hook_event_name: "Stop",
      stop_hook_active: false,
    }),
  });

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("askScratchCleanup process boundary", () => {
  it("asks Claude Code through additionalContext, naming the scratchpad and the cleanup command", () => {
    const homeRoot = createHomeRoot();
    const scratchpad = path.join(readClaudeSessionFolder(homeRoot), "scratchpad");
    writeScratchFile(scratchpad);

    const execution = runClaudeHook({
      homeRoot,
      stopInput: { stop_hook_active: false, background_tasks: [], session_crons: [] },
    });

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    expect(JSON.parse(execution.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: expect.stringContaining(`- ${scratchpad}\n`),
      },
    });
    expect(execution.stdout).toContain(`clear-scratch.ts\\" ${sessionId}`);
  });

  it("asks an interactive Codex thread by continuing its turn", () => {
    const homeRoot = createHomeRoot();
    writeScratchFile(readCodexThreadFolder(homeRoot));
    const rolloutFile = writeRollout({ homeRoot, source: "cli" });

    const execution = runCodexHook({ homeRoot, rolloutFile });

    expect(execution.status).toBe(0);
    expect(JSON.parse(execution.stdout)).toEqual({
      decision: "block",
      reason: expect.stringContaining(`- ${readCodexThreadFolder(homeRoot)}\n`),
    });
  });

  it.each([
    ["the turn is already continuing after a Stop hook", { stop_hook_active: true }],
    ["a background task is still in flight", { background_tasks: [{ id: "task-1", status: "running" }] }],
    ["a wakeup is scheduled", { session_crons: [{ id: "cron-1" }] }],
  ])("stays quiet in Claude Code when %s", (_situation, stopDetails) => {
    const homeRoot = createHomeRoot();
    writeScratchFile(path.join(readClaudeSessionFolder(homeRoot), "scratchpad"));

    const execution = runClaudeHook({ homeRoot, stopInput: stopDetails });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it.each([
    ["in a headless run, whose last message is its answer", "0"],
    ["when Claude Code does not say whether a person is at the session", ""],
  ])("stays quiet in Claude Code %s", (_situation, attendedFlag) => {
    const homeRoot = createHomeRoot();
    writeScratchFile(path.join(readClaudeSessionFolder(homeRoot), "scratchpad"));

    const execution = runHook({
      homeRoot,
      agentId: "claude-code",
      attendedFlag,
      hookInput: JSON.stringify({ session_id: sessionId, stop_hook_active: false }),
    });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("stays quiet when only the harness's task output holds files, or the scratchpad holds empty folders", () => {
    const homeRoot = createHomeRoot();
    writeScratchFile(path.join(readClaudeSessionFolder(homeRoot), "tasks"));
    mkdirSync(path.join(readClaudeSessionFolder(homeRoot), "scratchpad", "emptied"), { recursive: true });

    const execution = runClaudeHook({ homeRoot, stopInput: { stop_hook_active: false } });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it.each([
    ["a headless exec thread", "exec"],
    ["a subagent thread", { subagent: { thread_spawn: { depth: 1 } } }],
  ])("stays quiet in Codex for %s", (_situation, origin) => {
    const homeRoot = createHomeRoot();
    writeScratchFile(readCodexThreadFolder(homeRoot));
    const rolloutFile = writeRollout({ homeRoot, source: origin });

    const execution = runCodexHook({ homeRoot, rolloutFile });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("stays quiet in Codex when the thread has no rollout to tell how it was started", () => {
    const homeRoot = createHomeRoot();
    writeScratchFile(readCodexThreadFolder(homeRoot));

    const execution = runCodexHook({ homeRoot, rolloutFile: null });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("fails open with clean output on malformed input or a session ID that is not a UUID", () => {
    const homeRoot = createHomeRoot();
    writeScratchFile(path.join(readClaudeSessionFolder(homeRoot), "scratchpad"));

    const malformed = runHook({ homeRoot, agentId: "claude-code", attendedFlag: "1", hookInput: "{" });
    const foreignId = runHook({
      homeRoot,
      agentId: "claude-code",
      attendedFlag: "1",
      hookInput: JSON.stringify({ session_id: "..", stop_hook_active: false }),
    });

    expect([malformed.status, malformed.stdout, malformed.stderr]).toEqual([0, "", ""]);
    expect([foreignId.status, foreignId.stdout, foreignId.stderr]).toEqual([0, "", ""]);
  });
});
