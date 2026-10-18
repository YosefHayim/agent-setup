import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const watcherPath = fileURLToPath(new URL("./scratchWatcher.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(watcherPath), "../../../..");
const endedSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const otherSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const threadId = "01a0e4bf-1e83-7532-9119-d78525246a31";
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const workspaces: Array<string> = [];

const createHomeRoot = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-watcher-"));
  workspaces.push(homeRoot);
  return homeRoot;
};

const claudeSessionFolder = (request: { readonly homeRoot: string; readonly sessionId: string }) =>
  path.join(request.homeRoot, "claude-scratch", `claude-${process.getuid?.()}`, "-Users-me-repo", request.sessionId);

const codexScratchFolder = (request: { readonly homeRoot: string; readonly name: string }) =>
  path.join(request.homeRoot, ".codex", "scratchpads", request.name);

const writeScratchFile = (file: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "scratch\n");
};

const createSessionFolder = (request: { readonly homeRoot: string; readonly sessionId: string }): string => {
  const sessionFolder = claudeSessionFolder(request);
  writeScratchFile(path.join(sessionFolder, "scratchpad", "notes.txt"));
  writeScratchFile(path.join(sessionFolder, "tasks", "b1.output"));
  return sessionFolder;
};

// Sets when the folder and everything in it last changed, the way a session that stopped that long ago left it.
const leaveUntouchedFor = (request: { readonly folder: string; readonly days: number }) => {
  const lastChange = new Date(Date.now() - request.days * DAY_MILLISECONDS);
  const entryNames = readdirSync(request.folder, { recursive: true, encoding: "utf8" });
  for (const entry of [request.folder, ...entryNames.map((name) => path.join(request.folder, name))]) {
    utimesSync(entry, lastChange, lastChange);
  }
};

const registerRunningSession = (request: { readonly homeRoot: string; readonly sessionId: string }) => {
  const registryFolder = path.join(request.homeRoot, ".claude", "sessions");
  mkdirSync(registryFolder, { recursive: true });
  writeFileSync(
    path.join(registryFolder, `${process.pid}.json`),
    JSON.stringify({ sessionId: request.sessionId, pid: process.pid }),
  );
};

// A folder that links to itself cannot be listed even by root, which ignores file modes.
const linkToItself = (folder: string) => {
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(folder, folder);
};

// Inside a git hook these tests inherit GIT_DIR, which would aim every command at the repository being committed.
const isolatedGitEnvironment = (): NodeJS.ProcessEnv => {
  const variables = Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"));
  return { ...Object.fromEntries(variables), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
};

const createRepositoryWithUncommittedWork = (workTree: string) => {
  mkdirSync(workTree, { recursive: true });
  const initialization = spawnSync("git", ["init", "--quiet"], { cwd: workTree, env: isolatedGitEnvironment() });
  writeFileSync(path.join(workTree, "feature.ts"), "export const feature = 1;\n");
  return initialization.status;
};

// A clone whose every commit is on its remote, with one tracked file gone the way a delete that was cut off leaves it.
const createHalfDeletedClone = (request: { readonly upstream: string; readonly clone: string }) => {
  const identity = ["-c", "user.name=Scratch Test", "-c", "user.email=scratch@example.test"];
  mkdirSync(request.upstream, { recursive: true });
  writeFileSync(path.join(request.upstream, "README.md"), "content\n");
  writeFileSync(path.join(request.upstream, "feature.ts"), "export const feature = 1;\n");
  const gitSteps = [
    ["init", "--quiet"],
    ["add", "."],
    [...identity, "commit", "--quiet", "--message", "add files"],
    ["clone", "--quiet", ".", request.clone],
  ];
  const stepStatuses = gitSteps.map((step) => {
    const execution = spawnSync("git", step, { cwd: request.upstream, env: isolatedGitEnvironment() });
    return execution.status;
  });
  rmSync(path.join(request.clone, "README.md"));
  return stepStatuses;
};

const sessionEnvironment = (homeRoot: string): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: homeRoot,
  CLAUDE_CONFIG_DIR: path.join(homeRoot, ".claude"),
  CLAUDE_CODE_TMPDIR: path.join(homeRoot, "claude-scratch"),
  CODEX_HOME: path.join(homeRoot, ".codex"),
});

const runWatcher = (request: { readonly homeRoot: string; readonly watcherArguments: ReadonlyArray<string> }) =>
  spawnSync(process.execPath, ["--import", "tsx", watcherPath, ...request.watcherArguments], {
    encoding: "utf8",
    env: sessionEnvironment(request.homeRoot),
  });

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("scratchWatcher process boundary", () => {
  it("removes the ended session's folder and leaves a session that is still writing", () => {
    const homeRoot = createHomeRoot();
    const endedFolder = createSessionFolder({ homeRoot, sessionId: endedSessionId });
    const otherFolder = createSessionFolder({ homeRoot, sessionId: otherSessionId });

    const execution = runWatcher({ homeRoot, watcherArguments: [endedSessionId] });

    expect(execution.status).toBe(0);
    expect(existsSync(endedFolder)).toBe(false);
    expect(existsSync(path.join(otherFolder, "scratchpad", "notes.txt"))).toBe(true);
  });

  it("removes the folder a killed session left once nothing in it changed for a day", () => {
    const homeRoot = createHomeRoot();
    const abandonedFolder = createSessionFolder({ homeRoot, sessionId: otherSessionId });
    leaveUntouchedFor({ folder: abandonedFolder, days: 2 });

    const execution = runWatcher({ homeRoot, watcherArguments: [] });

    expect(execution.status).toBe(0);
    expect(existsSync(abandonedFolder)).toBe(false);
  });

  it("keeps a quiet folder whose session is still running", () => {
    const homeRoot = createHomeRoot();
    const idleFolder = createSessionFolder({ homeRoot, sessionId: otherSessionId });
    leaveUntouchedFor({ folder: idleFolder, days: 30 });
    registerRunningSession({ homeRoot, sessionId: otherSessionId });

    const execution = runWatcher({ homeRoot, watcherArguments: [] });

    expect(execution.status).toBe(0);
    expect(existsSync(path.join(idleFolder, "scratchpad", "notes.txt"))).toBe(true);
  });

  it("keeps every quiet folder while the session registry cannot be listed, and still removes the ended one", () => {
    const homeRoot = createHomeRoot();
    const endedFolder = createSessionFolder({ homeRoot, sessionId: endedSessionId });
    const idleFolder = createSessionFolder({ homeRoot, sessionId: otherSessionId });
    leaveUntouchedFor({ folder: idleFolder, days: 30 });
    linkToItself(path.join(homeRoot, ".claude", "sessions"));

    const execution = runWatcher({ homeRoot, watcherArguments: [endedSessionId] });

    expect(execution.status).toBe(0);
    expect(existsSync(endedFolder)).toBe(false);
    expect(existsSync(path.join(idleFolder, "scratchpad", "notes.txt"))).toBe(true);
  });

  it("keeps a folder with one file changed within the day", () => {
    const homeRoot = createHomeRoot();
    const sessionFolder = createSessionFolder({ homeRoot, sessionId: otherSessionId });
    leaveUntouchedFor({ folder: sessionFolder, days: 2 });
    const freshFile = path.join(sessionFolder, "scratchpad", "notes.txt");
    utimesSync(freshFile, new Date(), new Date());

    const execution = runWatcher({ homeRoot, watcherArguments: [] });

    expect(execution.status).toBe(0);
    expect(existsSync(freshFile)).toBe(true);
  });

  it("removes a Codex scratch folder after a quiet week and keeps a newer one", () => {
    const homeRoot = createHomeRoot();
    const oldThreadFolder = codexScratchFolder({ homeRoot, name: threadId });
    const recentNamedFolder = codexScratchFolder({ homeRoot, name: "release-check" });
    writeScratchFile(path.join(oldThreadFolder, "runs", "probe.log"));
    writeScratchFile(path.join(recentNamedFolder, "probe.log"));
    leaveUntouchedFor({ folder: oldThreadFolder, days: 8 });
    leaveUntouchedFor({ folder: recentNamedFolder, days: 3 });

    const execution = runWatcher({ homeRoot, watcherArguments: [] });

    expect(execution.status).toBe(0);
    expect(existsSync(oldThreadFolder)).toBe(false);
    expect(existsSync(path.join(recentNamedFolder, "probe.log"))).toBe(true);
  });

  it("does not remove an ended Codex thread's folder, because a thread can be picked up again", () => {
    const homeRoot = createHomeRoot();
    const threadFolder = codexScratchFolder({ homeRoot, name: threadId });
    writeScratchFile(path.join(threadFolder, "probe.log"));

    const execution = runWatcher({ homeRoot, watcherArguments: [threadId] });

    expect(execution.status).toBe(0);
    expect(existsSync(path.join(threadFolder, "probe.log"))).toBe(true);
  });

  it("keeps a git work tree with uncommitted work in an abandoned folder and removes the rest", () => {
    const homeRoot = createHomeRoot();
    const abandonedFolder = createSessionFolder({ homeRoot, sessionId: otherSessionId });
    const workTree = path.join(abandonedFolder, "scratchpad", "feature-clone");
    const initializationStatus = createRepositoryWithUncommittedWork(workTree);
    leaveUntouchedFor({ folder: abandonedFolder, days: 2 });

    const execution = runWatcher({ homeRoot, watcherArguments: [] });

    expect(initializationStatus).toBe(0);
    expect(execution.status).toBe(0);
    expect(existsSync(path.join(workTree, "feature.ts"))).toBe(true);
    expect(readdirSync(abandonedFolder)).toEqual(["scratchpad"]);
    expect(readdirSync(path.join(abandonedFolder, "scratchpad"))).toEqual(["feature-clone"]);
  });

  it("removes an abandoned folder whose pushed clone was left half deleted", () => {
    const homeRoot = createHomeRoot();
    const abandonedFolder = createSessionFolder({ homeRoot, sessionId: otherSessionId });
    const clone = path.join(abandonedFolder, "scratchpad", "main-check");
    const stepStatuses = createHalfDeletedClone({ upstream: path.join(homeRoot, "upstream"), clone });
    leaveUntouchedFor({ folder: abandonedFolder, days: 2 });

    const execution = runWatcher({ homeRoot, watcherArguments: [] });

    expect(stepStatuses).toEqual([0, 0, 0, 0]);
    expect(execution.status).toBe(0);
    expect(existsSync(abandonedFolder)).toBe(false);
  });

  it("fails open when the home folder cannot be read", () => {
    const missingHomeRoot = path.join(createHomeRoot(), "missing");

    const execution = runWatcher({ homeRoot: missingHomeRoot, watcherArguments: [endedSessionId] });

    expect(execution.status).toBe(0);
  });
});
