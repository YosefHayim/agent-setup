import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const watcherPath = fileURLToPath(new URL("./rehomeWatcher.ts", import.meta.url));
const endedHookPath = fileURLToPath(new URL("../hooks/rehomeEndedSession.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(watcherPath), "../../../..");
const sessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const threadId = "01a0e4bf-1e83-7532-9119-d78525246a31";
const childThreadId = "01a0e507-1548-7562-8fae-45ca310037cc";
const workspaces: Array<string> = [];

type Workspace = { readonly homeRoot: string; readonly codeRoot: string; readonly stateFolder: string };

const createWorkspace = (): Workspace => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-session-rehome-"));
  workspaces.push(homeRoot);
  const codeRoot = path.join(homeRoot, "Desktop", "Code");
  for (const repoName of ["vybekiit", "replybase"]) {
    mkdirSync(path.join(codeRoot, repoName, ".git"), { recursive: true });
  }
  return { homeRoot, codeRoot, stateFolder: path.join(homeRoot, "rehome-state") };
};

const projectFolder = (request: { readonly workspace: Workspace; readonly folder: string }) =>
  path.join(request.workspace.homeRoot, ".claude", "projects", request.folder.replace(/[^A-Za-z0-9-]/g, "-"));

const toolLine = (request: { readonly cwd: string; readonly filePath: string }) =>
  JSON.stringify({
    type: "assistant",
    cwd: request.cwd,
    sessionId,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name: "Edit", input: { file_path: request.filePath } }],
    },
  });

// Old enough that the sweep's quiet window does not treat it as a running session.
const ageFile = (file: string) => {
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1_000);
  utimesSync(file, anHourAgo, anHourAgo);
};

const createClaudeSession = (request: {
  readonly workspace: Workspace;
  readonly startFolder: string;
  readonly editedRepo: string;
}) => {
  const folder = projectFolder({ workspace: request.workspace, folder: request.startFolder });
  mkdirSync(path.join(folder, sessionId, "subagents"), { recursive: true });
  writeFileSync(path.join(folder, sessionId, "subagents", "agent-1.jsonl"), "{}\n");
  const prompt = JSON.stringify({
    type: "user",
    cwd: request.startFolder,
    sessionId,
    message: { role: "user", content: `fix the ${request.editedRepo} checkout page` },
  });
  const edits = Array.from({ length: 12 }, (_, index) =>
    toolLine({
      cwd: request.startFolder,
      filePath: path.join(request.workspace.codeRoot, request.editedRepo, `src/page${index}.ts`),
    }),
  );
  const transcript = path.join(folder, `${sessionId}.jsonl`);
  writeFileSync(transcript, `${[prompt, ...edits].join("\n")}\n`);
  ageFile(transcript);
  return transcript;
};

const watcherEnvironment = (workspace: Workspace) => ({
  ...process.env,
  HOME: workspace.homeRoot,
  CLAUDE_CONFIG_DIR: path.join(workspace.homeRoot, ".claude"),
  CODEX_HOME: path.join(workspace.homeRoot, ".codex"),
  AGENT_SETUP_REHOME_STATE_DIR: workspace.stateFolder,
});

const runWatcher = (request: { readonly workspace: Workspace; readonly args: ReadonlyArray<string> }) =>
  spawnSync(process.execPath, ["--import", "tsx", watcherPath, ...request.args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: watcherEnvironment(request.workspace),
  });

const ledgerLines = (workspace: Workspace) =>
  readFileSync(path.join(workspace.stateFolder, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

// A folder that links to itself cannot be listed even by root, which ignores file modes.
const linkToItself = (folder: string) => {
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(folder, folder);
};

const lastLine = (file: string) => JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1) || "{}");

const waitUntil = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("rehome watcher with Claude Code sessions", () => {
  it("moves a session started in the code folder into the repo it edited, with its session folder", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const vybekiitRoot = path.join(workspace.codeRoot, "vybekiit");
    const movedTranscript = path.join(projectFolder({ workspace, folder: vybekiitRoot }), `${sessionId}.jsonl`);

    const execution = runWatcher({ workspace, args: ["--sweep"] });

    expect(execution.status).toBe(0);
    expect(existsSync(transcript)).toBe(false);
    expect(existsSync(movedTranscript)).toBe(true);
    expect(existsSync(path.join(path.dirname(movedTranscript), sessionId, "subagents", "agent-1.jsonl"))).toBe(true);
    expect(lastLine(movedTranscript)).toEqual({ type: "relocated", sessionId, relocatedCwd: vybekiitRoot });
    expect(ledgerLines(workspace)).toEqual([
      expect.objectContaining({ agent: "claude-code", sessionId, decision: "moved", toFolder: vybekiitRoot }),
    ]);
  });

  it("leaves a session id stored in two project folders untouched", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const strayCopy = path.join(projectFolder({ workspace, folder: workspace.homeRoot }), `${sessionId}.jsonl`);
    mkdirSync(path.dirname(strayCopy), { recursive: true });
    copyFileSync(transcript, strayCopy);
    ageFile(strayCopy);

    const sweep = runWatcher({ workspace, args: ["--sweep", "--json"] });
    const ended = runWatcher({ workspace, args: ["--agent", "claude-code", "--session", sessionId, "--json"] });

    expect(JSON.parse(sweep.stdout)).toEqual([]);
    expect(JSON.parse(ended.stdout)).toEqual([]);
    expect(existsSync(transcript)).toBe(true);
    expect(existsSync(strayCopy)).toBe(true);
  });

  it("only reports the move in a dry run", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });

    const execution = runWatcher({ workspace, args: ["--sweep", "--dry-run", "--json"] });

    expect(existsSync(transcript)).toBe(true);
    expect(JSON.parse(execution.stdout)).toEqual([
      expect.objectContaining({ sessionId, action: "move", repoName: "vybekiit", status: "planned" }),
    ]);
  });

  it("leaves a session alone while a running Claude Code process holds it", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    mkdirSync(path.join(workspace.homeRoot, ".claude", "sessions"), { recursive: true });
    writeFileSync(
      path.join(workspace.homeRoot, ".claude", "sessions", `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId }),
    );

    runWatcher({ workspace, args: ["--sweep"] });

    expect(existsSync(transcript)).toBe(true);
  });

  it("leaves a session alone while a process of a second Claude account holds it", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const secondAccountRegistry = path.join(workspace.homeRoot, ".claude-work", "sessions");
    mkdirSync(secondAccountRegistry, { recursive: true });
    writeFileSync(
      path.join(secondAccountRegistry, `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId }),
    );

    runWatcher({ workspace, args: ["--sweep"] });

    expect(existsSync(transcript)).toBe(true);
  });

  it("leaves a session alone while a background job of a second Claude account owns it", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const jobFolder = path.join(workspace.homeRoot, ".claude-work", "jobs", "5cc2fa97");
    mkdirSync(jobFolder, { recursive: true });
    writeFileSync(path.join(jobFolder, "state.json"), JSON.stringify({ sessionId, state: "stopped" }));

    runWatcher({ workspace, args: ["--sweep"] });

    expect(existsSync(transcript)).toBe(true);
  });

  it("leaves every session alone while a jobs folder cannot be listed", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    linkToItself(path.join(workspace.homeRoot, ".claude", "jobs"));

    runWatcher({ workspace, args: ["--sweep"] });

    expect(existsSync(transcript)).toBe(true);
  });

  it("moves a session whose background job is done", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const jobFolder = path.join(workspace.homeRoot, ".claude", "jobs", "5cc2fa97");
    mkdirSync(jobFolder, { recursive: true });
    writeFileSync(path.join(jobFolder, "state.json"), JSON.stringify({ sessionId, state: "done" }));

    runWatcher({ workspace, args: ["--sweep"] });

    expect(existsSync(transcript)).toBe(false);
  });

  it("reads only each job's own state.json, never one among the job's files", () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const jobFilesFolder = path.join(workspace.homeRoot, ".claude", "jobs", "5cc2fa97", "tmp", "copied-job");
    mkdirSync(jobFilesFolder, { recursive: true });
    writeFileSync(path.join(jobFilesFolder, "state.json"), JSON.stringify({ sessionId }));

    runWatcher({ workspace, args: ["--sweep"] });

    expect(existsSync(transcript)).toBe(false);
  });

  it("deletes what a second Claude account kept for a deleted session, and nothing of its other sessions", () => {
    const workspace = createWorkspace();
    const ariaFolder = path.join(workspace.codeRoot, "aria");
    createClaudeSession({ workspace, startFolder: ariaFolder, editedRepo: "aria" });
    const secondAccountRoot = path.join(workspace.homeRoot, ".claude-work");
    const fileHistory = path.join(secondAccountRoot, "file-history", sessionId);
    const promptHistory = path.join(secondAccountRoot, "history.jsonl");
    const deletedPrompt = JSON.stringify({ sessionId, display: "fix the aria checkout page" });
    const keptPrompt = JSON.stringify({ sessionId: "f7990b95-b427-4bfb-a8d6-cd6f5013ce14", display: "keep" });
    mkdirSync(fileHistory, { recursive: true });
    symlinkSync(path.join(workspace.homeRoot, ".claude", "projects"), path.join(secondAccountRoot, "projects"));
    writeFileSync(promptHistory, `${deletedPrompt}\n${keptPrompt}\n`);

    runWatcher({ workspace, args: ["--sweep", "--delete-repo", "aria"] });

    expect(existsSync(fileHistory)).toBe(false);
    expect(readFileSync(promptHistory, "utf8")).toBe(`${keptPrompt}\n`);
  });

  it("leaves a backup folder's copy of a deleted session alone, since it has a projects folder of its own", () => {
    const workspace = createWorkspace();
    const ariaFolder = path.join(workspace.codeRoot, "aria");
    createClaudeSession({ workspace, startFolder: ariaFolder, editedRepo: "aria" });
    const backupRoot = path.join(workspace.homeRoot, ".claude-backup");
    const fileHistory = path.join(backupRoot, "file-history", sessionId);
    const promptHistory = path.join(backupRoot, "history.jsonl");
    const backedUpPrompt = JSON.stringify({ sessionId, display: "fix the aria checkout page" });
    mkdirSync(fileHistory, { recursive: true });
    mkdirSync(path.join(backupRoot, "projects"));
    writeFileSync(promptHistory, `${backedUpPrompt}\n`);

    runWatcher({ workspace, args: ["--sweep", "--delete-repo", "aria"] });

    expect(existsSync(fileHistory)).toBe(true);
    expect(readFileSync(promptHistory, "utf8")).toBe(`${backedUpPrompt}\n`);
  });

  it("keeps the prompt history readable by its owner only after it removes a deleted session's lines", () => {
    const workspace = createWorkspace();
    const ariaFolder = path.join(workspace.codeRoot, "aria");
    createClaudeSession({ workspace, startFolder: ariaFolder, editedRepo: "aria" });
    const promptHistory = path.join(workspace.homeRoot, ".claude", "history.jsonl");
    writeFileSync(promptHistory, `${JSON.stringify({ sessionId, display: "fix the aria checkout page" })}\n`);
    chmodSync(promptHistory, 0o600);

    runWatcher({ workspace, args: ["--sweep", "--delete-repo", "aria"] });

    expect(readFileSync(promptHistory, "utf8")).toBe("");
    expect(statSync(promptHistory).mode & 0o777).toBe(0o600);
  });

  it("deletes the sessions of a repo named for deletion, and that repo's project folder", () => {
    const workspace = createWorkspace();
    const ariaFolder = path.join(workspace.codeRoot, "aria");
    const transcript = createClaudeSession({ workspace, startFolder: ariaFolder, editedRepo: "aria" });

    const execution = runWatcher({ workspace, args: ["--sweep", "--delete-repo", "aria"] });

    expect(execution.status).toBe(0);
    expect(existsSync(transcript)).toBe(false);
    expect(existsSync(projectFolder({ workspace, folder: ariaFolder }))).toBe(false);
    expect(ledgerLines(workspace)).toEqual([expect.objectContaining({ decision: "deleted", repoName: "aria" })]);
  });

  it("places an uncertain session where the user assigns it", () => {
    const workspace = createWorkspace();
    createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const replybaseRoot = path.join(workspace.codeRoot, "replybase");

    runWatcher({ workspace, args: ["--sweep", "--assign", `${sessionId.slice(0, 8)}=replybase`] });

    expect(existsSync(path.join(projectFolder({ workspace, folder: replybaseRoot }), `${sessionId}.jsonl`))).toBe(true);
  });

  it("is handed an ended session by the SessionEnd hook and moves it once the agent lets go", async () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const movedTranscript = path.join(
      projectFolder({ workspace, folder: path.join(workspace.codeRoot, "vybekiit") }),
      `${sessionId}.jsonl`,
    );

    const hook = spawnSync(process.execPath, ["--import", "tsx", endedHookPath], {
      cwd: packageRoot,
      input: JSON.stringify({ session_id: sessionId, transcript_path: transcript, reason: "prompt_input_exit" }),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: workspace.homeRoot,
        CLAUDE_CONFIG_DIR: path.join(workspace.homeRoot, ".claude"),
        AGENT_SETUP_AGENT_ID: "claude-code",
        AGENT_SETUP_REHOME_STATE_DIR: workspace.stateFolder,
      },
    });
    const lockFile = path.join(workspace.stateFolder, "watcher.lock");
    const ledgerFile = path.join(workspace.stateFolder, "ledger.jsonl");
    await waitUntil(() => existsSync(movedTranscript) && existsSync(ledgerFile) && !existsSync(lockFile));

    expect(hook.status).toBe(0);
    expect(existsSync(movedTranscript)).toBe(true);
  });

  it("waits while another watcher holds the lock, and moves the ended session once it lets go", async () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const lockFile = path.join(workspace.stateFolder, "watcher.lock");
    mkdirSync(workspace.stateFolder, { recursive: true });
    writeFileSync(lockFile, String(process.pid));

    const waiter = spawn(
      process.execPath,
      ["--import", "tsx", watcherPath, "--agent", "claude-code", "--session", sessionId, "--wait"],
      { cwd: packageRoot, stdio: "ignore", env: watcherEnvironment(workspace) },
    );
    const waiterExit = new Promise((resolve) => waiter.once("exit", resolve));
    try {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const waitedWhileLocked = existsSync(transcript);
      rmSync(lockFile);
      await waitUntil(() => !existsSync(transcript));

      expect(waitedWhileLocked).toBe(true);
      expect(existsSync(transcript)).toBe(false);
    } finally {
      waiter.kill();
      await waiterExit;
    }
  });

  it("finds an ended session again after another watcher moved it, and still places it", async () => {
    const workspace = createWorkspace();
    const transcript = createClaudeSession({ workspace, startFolder: workspace.codeRoot, editedRepo: "vybekiit" });
    const replybaseRoot = path.join(workspace.codeRoot, "replybase");
    const replybaseFolder = projectFolder({ workspace, folder: replybaseRoot });
    const replybaseTranscript = path.join(replybaseFolder, `${sessionId}.jsonl`);
    const vybekiitFolder = projectFolder({ workspace, folder: path.join(workspace.codeRoot, "vybekiit") });
    const lockFile = path.join(workspace.stateFolder, "watcher.lock");
    mkdirSync(workspace.stateFolder, { recursive: true });
    writeFileSync(lockFile, String(process.pid));

    const waiter = spawn(
      process.execPath,
      ["--import", "tsx", watcherPath, "--agent", "claude-code", "--session", sessionId, "--wait"],
      { cwd: packageRoot, stdio: "ignore", env: watcherEnvironment(workspace) },
    );
    const waiterExit = new Promise((resolve) => waiter.once("exit", resolve));
    try {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      mkdirSync(replybaseFolder, { recursive: true });
      renameSync(transcript, replybaseTranscript);
      renameSync(path.join(path.dirname(transcript), sessionId), path.join(replybaseFolder, sessionId));
      const relocated = JSON.stringify({ type: "relocated", sessionId, relocatedCwd: replybaseRoot });
      appendFileSync(replybaseTranscript, `${relocated}\n`);
      ageFile(replybaseTranscript);
      rmSync(lockFile);
      await waiterExit;

      expect(existsSync(replybaseTranscript)).toBe(false);
      expect(existsSync(path.join(vybekiitFolder, `${sessionId}.jsonl`))).toBe(true);
    } finally {
      waiter.kill();
    }
  });

  it("fails open on malformed SessionEnd input", () => {
    const hook = spawnSync(process.execPath, ["--import", "tsx", endedHookPath], {
      cwd: packageRoot,
      input: "{",
      encoding: "utf8",
      env: { ...process.env, AGENT_SETUP_AGENT_ID: "claude-code" },
    });

    expect(hook.status).toBe(0);
  });
});

const THREADS_SCHEMA = `
CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL,
  first_user_message TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, thread_source TEXT);
CREATE TABLE thread_spawn_edges (parent_thread_id TEXT NOT NULL, child_thread_id TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL);`;

const settingsLine = (request: { readonly cwd: string; readonly ordinal: number }) =>
  JSON.stringify({
    timestamp: "2026-09-27T21:33:41.720Z",
    ordinal: request.ordinal,
    type: "event_msg",
    payload: {
      type: "thread_settings_applied",
      thread_id: threadId,
      thread_settings: { model: "gpt", cwd: request.cwd, runtime_workspace_roots: [request.cwd] },
    },
  });

const commandLine = (request: { readonly cwd: string; readonly ordinal: number }) =>
  JSON.stringify({
    ordinal: request.ordinal,
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: { type: "CommandExecution", cwd: request.cwd, command: ["/bin/zsh", "-lc", "pnpm test"] },
    },
  });

const createCodexThread = (workspace: Workspace) => {
  const sessionsFolder = path.join(workspace.homeRoot, ".codex", "sessions", "2026", "09", "28");
  mkdirSync(sessionsFolder, { recursive: true });
  const replybaseRoot = path.join(workspace.codeRoot, "replybase");
  const rolloutFile = path.join(sessionsFolder, `rollout-2026-09-28T00-33-41-${threadId}.jsonl`);
  const childRolloutFile = path.join(sessionsFolder, `rollout-2026-09-28T00-40-00-${childThreadId}.jsonl`);
  const commands = Array.from({ length: 12 }, (_, index) => commandLine({ cwd: replybaseRoot, ordinal: index + 2 }));
  writeFileSync(rolloutFile, `${[settingsLine({ cwd: workspace.codeRoot, ordinal: 1 }), ...commands].join("\n")}\n`);
  writeFileSync(childRolloutFile, `${settingsLine({ cwd: workspace.codeRoot, ordinal: 1 })}\n`);
  for (const file of [rolloutFile, childRolloutFile]) {
    ageFile(file);
  }

  const database = new DatabaseSync(path.join(workspace.homeRoot, ".codex", "state_5.sqlite"));
  database.exec(THREADS_SCHEMA);
  const insertThread = database.prepare(
    "INSERT INTO threads (id, rollout_path, cwd, title, thread_source) VALUES (?, ?, ?, ?, ?)",
  );
  insertThread.run(threadId, rolloutFile, workspace.codeRoot, "fix replybase widget", "user");
  insertThread.run(childThreadId, childRolloutFile, workspace.codeRoot, "", "subagent");
  database.prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, 'closed')").run(threadId, childThreadId);
  database.close();
  return { rolloutFile, childRolloutFile, replybaseRoot };
};

const threadCwds = (workspace: Workspace) => {
  const database = new DatabaseSync(path.join(workspace.homeRoot, ".codex", "state_5.sqlite"), { readOnly: true });
  const rows = database.prepare("SELECT id, cwd FROM threads ORDER BY id").all();
  database.close();
  return rows;
};

describe("rehome watcher with Codex threads", () => {
  it("moves a thread and its subagents: rows updated and a settings line appended with the next ordinal", () => {
    const workspace = createWorkspace();
    const { rolloutFile, childRolloutFile, replybaseRoot } = createCodexThread(workspace);

    const execution = runWatcher({ workspace, args: ["--sweep", "--agent", "codex"] });

    expect(execution.status).toBe(0);
    expect(threadCwds(workspace)).toEqual([
      { id: threadId, cwd: replybaseRoot },
      { id: childThreadId, cwd: replybaseRoot },
    ]);
    expect(lastLine(rolloutFile)).toMatchObject({
      ordinal: 14,
      payload: {
        type: "thread_settings_applied",
        thread_settings: { cwd: replybaseRoot, runtime_workspace_roots: [replybaseRoot] },
      },
    });
    expect(lastLine(childRolloutFile)).toMatchObject({
      ordinal: 2,
      payload: { thread_settings: { cwd: replybaseRoot } },
    });
  });

  it("puts a moved thread back when Codex rebuilds its row with the old folder", () => {
    const workspace = createWorkspace();
    const { replybaseRoot } = createCodexThread(workspace);
    runWatcher({ workspace, args: ["--sweep", "--agent", "codex"] });
    const database = new DatabaseSync(path.join(workspace.homeRoot, ".codex", "state_5.sqlite"));
    database.prepare("UPDATE threads SET cwd = ? WHERE id = ?").run(workspace.codeRoot, threadId);
    database.close();

    runWatcher({ workspace, args: ["--sweep", "--agent", "codex"] });

    expect(threadCwds(workspace)).toContainEqual({ id: threadId, cwd: replybaseRoot });
  });
});
