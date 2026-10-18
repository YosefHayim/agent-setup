import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const watcherPath = fileURLToPath(new URL("./cleanupWatcher.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(watcherPath), "../../../..");
const endedSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const liveSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const otherSessionId = "0b6f1d2e-3c4a-4e5f-8a9b-1c2d3e4f5a6b";
const codexThreadId = "019a2c41-7d3e-7b10-9c2a-5e4f6a7b8c9d";
const PRUNE_TOOLS = ["xcrun", "pnpm", "uv", "docker"];
const MONTH_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1_000);
const workspaces: Array<string> = [];

// Inside a git hook these tests inherit GIT_DIR, which would aim every command at the repository being committed.
const isolatedGitEnvironment = (): NodeJS.ProcessEnv => {
  const variables = Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"));
  return { ...Object.fromEntries(variables), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
};

const git = (request: { readonly folder: string; readonly command: ReadonlyArray<string> }): string => {
  const identity = ["-c", "user.name=Cleanup Test", "-c", "user.email=cleanup@example.test"];
  const execution = spawnSync("git", [...identity, "-c", "init.defaultBranch=main", ...request.command], {
    cwd: request.folder,
    encoding: "utf8",
    env: isolatedGitEnvironment(),
  });
  if (execution.status !== 0) {
    throw new Error(`git ${request.command.join(" ")} failed: ${execution.stderr}`);
  }
  return execution.stdout.trim();
};

const commitFile = (request: { readonly workTree: string; readonly fileName: string }) => {
  writeFileSync(path.join(request.workTree, request.fileName), `${request.fileName}\n`);
  git({ folder: request.workTree, command: ["add", request.fileName] });
  git({ folder: request.workTree, command: ["commit", "--quiet", "--message", `add ${request.fileName}`] });
};

type CodeHome = {
  readonly homeRoot: string;
  readonly remote: string;
  readonly repo: string;
  readonly toolCallsFile: string;
};

// Each stub logs its call; docker's "info" fails when the engine is meant to be stopped.
const writePruneToolStubs = (request: { readonly homeRoot: string; readonly dockerRunning: boolean }) => {
  const stubsFolder = path.join(request.homeRoot, "stub-tools");
  const toolCallsFile = path.join(request.homeRoot, "tool-calls.log");
  const engineCheckExitCode = request.dockerRunning ? 0 : 1;
  mkdirSync(stubsFolder);
  for (const tool of PRUNE_TOOLS) {
    const stub = path.join(stubsFolder, tool);
    const engineCheck = tool === "docker" ? `[ "$1" = info ] && exit ${engineCheckExitCode}\n` : "";
    writeFileSync(stub, `#!/bin/sh\n${engineCheck}echo "${tool} $*" >> "${toolCallsFile}"\n`);
    chmodSync(stub, 0o755);
  }
  return toolCallsFile;
};

// A fake home with ~/Desktop/Code/app, cloned from a bare remote outside the code folders.
const createCodeHome = (options: { readonly dockerRunning: boolean } = { dockerRunning: true }): CodeHome => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-disk-cleanup-"));
  workspaces.push(homeRoot);
  // The watcher's own commits take their author from the home's git config.
  writeFileSync(path.join(homeRoot, ".gitconfig"), "[user]\n\tname = Cleanup Test\n\temail = cleanup@example.test\n");
  const remote = path.join(homeRoot, "remotes", "app.git");
  const repo = path.join(homeRoot, "Desktop", "Code", "app");
  mkdirSync(remote, { recursive: true });
  git({ folder: remote, command: ["init", "--quiet", "--bare"] });
  git({ folder: homeRoot, command: ["clone", "--quiet", remote, repo] });
  commitFile({ workTree: repo, fileName: "README.md" });
  git({ folder: repo, command: ["push", "--quiet", "origin", "main"] });
  // A clone of a repository that already has commits learns the remote's default branch the same way.
  git({ folder: repo, command: ["remote", "set-head", "origin", "main"] });
  const toolCallsFile = writePruneToolStubs({ homeRoot, dockerRunning: options.dockerRunning });
  return { homeRoot, remote, repo, toolCallsFile };
};

const appendTranscriptLine = (request: {
  readonly home: CodeHome;
  readonly sessionId: string;
  readonly transcriptLine: Record<string, unknown>;
}) => {
  const projectFolder = path.join(request.home.homeRoot, ".claude", "projects", "-app");
  mkdirSync(projectFolder, { recursive: true });
  const transcriptFile = path.join(projectFolder, `${request.sessionId}.jsonl`);
  appendFileSync(transcriptFile, `${JSON.stringify(request.transcriptLine)}\n`);
};

// The creator's transcript names the worktree only by the relative path its git worktree add took, and the worktree
// is two hours old, past the hour a fresh one is kept.
const addWorktree = (request: {
  readonly home: CodeHome;
  readonly name: string;
  readonly checkoutOptions: ReadonlyArray<string>;
  readonly startPoint: ReadonlyArray<string>;
  readonly creatorId: string;
}): string => {
  const relativeFolder = path.join(".worktrees", request.name);
  const folder = path.join(request.home.repo, relativeFolder);
  const addCommand = ["worktree", "add", "--quiet", ...request.checkoutOptions, folder, ...request.startPoint];
  git({ folder: request.home.repo, command: addCommand });
  utimesSync(path.join(folder, ".git"), TWO_HOURS_AGO, TWO_HOURS_AGO);
  const toolUse = { type: "tool_use", name: "Bash", input: { command: `git worktree add ${relativeFolder}` } };
  const transcriptLine = { type: "assistant", cwd: request.home.repo, message: { content: [toolUse] } };
  appendTranscriptLine({ home: request.home, sessionId: request.creatorId, transcriptLine });
  return folder;
};

const addBranchWorktree = (request: { readonly home: CodeHome; readonly branch: string }) =>
  addWorktree({
    home: request.home,
    name: request.branch,
    checkoutOptions: ["-b", request.branch],
    startPoint: [],
    creatorId: endedSessionId,
  });

const watcherEnvironment = (home: CodeHome): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: home.homeRoot,
  PATH: `${path.join(home.homeRoot, "stub-tools")}:${process.env.PATH}`,
  CLAUDE_CONFIG_DIR: path.join(home.homeRoot, ".claude"),
  CODEX_HOME: path.join(home.homeRoot, ".codex"),
  AGENT_SETUP_DISK_CLEANUP_STATE_DIR: path.join(home.homeRoot, "disk-cleanup-state"),
});

const runWatcher = (request: { readonly home: CodeHome; readonly watcherArguments: ReadonlyArray<string> }) =>
  spawnSync(process.execPath, ["--import", "tsx", watcherPath, ...request.watcherArguments], {
    cwd: packageRoot,
    encoding: "utf8",
    env: watcherEnvironment(request.home),
  });

const cleanUpAfterSession = (home: CodeHome) => runWatcher({ home, watcherArguments: ["--session", endedSessionId] });

const reportLineFor = (request: { readonly report: string; readonly target: string }): string =>
  request.report.split("\n").find((line) => line.endsWith(` ${request.target}`)) || "";

const remoteBranches = (home: CodeHome): string =>
  git({ folder: home.remote, command: ["branch", "--list", "--format=%(refname:short)"] });

const toolCalls = (home: CodeHome): string =>
  existsSync(home.toolCallsFile) ? readFileSync(home.toolCallsFile, "utf8") : "";

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("cleanupWatcher worktrees", { timeout: 30_000 }, () => {
  it("commits and pushes the work left in a feature worktree, then removes it and keeps the branch", () => {
    const home = createCodeHome();
    const feature = addBranchWorktree({ home, branch: "feature" });
    commitFile({ workTree: feature, fileName: "login.ts" });
    writeFileSync(path.join(feature, "notes.md"), "not committed yet\n");

    const run = cleanUpAfterSession(home);

    expect(run.status).toBe(0);
    expect(reportLineFor({ report: run.stdout, target: feature })).toMatch(/^removed +pushed feature +\//);
    expect(existsSync(feature)).toBe(false);
    const pushedSubjects = git({ folder: home.remote, command: ["log", "--format=%s", "feature"] });
    expect(pushedSubjects.split("\n")).toEqual(["chore: save work left in worktree", "add login.ts", "add README.md"]);
    expect(git({ folder: home.repo, command: ["branch", "--list", "feature"] })).toContain("feature");
  });

  it("removes a worktree whose work is already on the remote without pushing", () => {
    const home = createCodeHome();
    const merged = addBranchWorktree({ home, branch: "merged" });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: merged })).toMatch(/^removed +nothing to push +\//);
    expect(existsSync(merged)).toBe(false);
    expect(remoteBranches(home)).toBe("main");
  });

  it("keeps worktrees whose work has no safe branch to go to, or holds files that must not be pushed", () => {
    const home = createCodeHome();
    const detached = addWorktree({
      home,
      name: "detached",
      checkoutOptions: ["--detach"],
      startPoint: [],
      creatorId: endedSessionId,
    });
    commitFile({ workTree: detached, fileName: "experiment.ts" });
    git({ folder: home.repo, command: ["switch", "--quiet", "--create", "trunk"] });
    const onMain = addWorktree({
      home,
      name: "on-main",
      checkoutOptions: [],
      startPoint: ["main"],
      creatorId: endedSessionId,
    });
    writeFileSync(path.join(onMain, "README.md"), "changed on main\n");
    const withKey = addBranchWorktree({ home, branch: "with-key" });
    writeFileSync(path.join(withKey, "signing.pem"), "private key\n");
    const committedKey = addBranchWorktree({ home, branch: "committed-key" });
    commitFile({ workTree: committedKey, fileName: "server.key" });
    commitFile({ workTree: committedKey, fileName: "routes.ts" });
    const locked = addBranchWorktree({ home, branch: "locked" });
    commitFile({ workTree: locked, fileName: "locked.ts" });
    git({ folder: home.repo, command: ["worktree", "lock", locked] });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: detached })).toMatch(/^kept +detached-work +\//);
    expect(reportLineFor({ report: run.stdout, target: onMain })).toMatch(/^kept +default-branch-work +\//);
    expect(reportLineFor({ report: run.stdout, target: withKey })).toMatch(/^kept +risky-files +\//);
    expect(reportLineFor({ report: run.stdout, target: committedKey })).toMatch(/^kept +risky-files +\//);
    expect(reportLineFor({ report: run.stdout, target: locked })).toMatch(/^kept +locked +\//);
    expect([detached, onMain, withKey, committedKey, locked].every((folder) => existsSync(folder))).toBe(true);
    expect(remoteBranches(home)).toBe("main");
  });

  it("keeps a worktree with work to push while the remote's default branch is unknown", () => {
    const home = createCodeHome();
    git({ folder: home.repo, command: ["remote", "set-head", "origin", "--delete"] });
    const develop = addBranchWorktree({ home, branch: "develop" });
    commitFile({ workTree: develop, fileName: "release.ts" });
    const merged = addBranchWorktree({ home, branch: "merged" });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: develop })).toMatch(/^kept +unknown-default-branch +\//);
    expect(reportLineFor({ report: run.stdout, target: merged })).toMatch(/^removed +nothing to push +\//);
    expect(remoteBranches(home)).toBe("main");
  });

  it("keeps an ignored secret file the main worktree lacks, and drops one it holds too", () => {
    const home = createCodeHome();
    writeFileSync(path.join(home.repo, ".gitignore"), "*.pem\nbuild/\nnode_modules/\n");
    git({ folder: home.repo, command: ["add", ".gitignore"] });
    git({ folder: home.repo, command: ["commit", "--quiet", "--message", "ignore keys"] });
    git({ folder: home.repo, command: ["push", "--quiet", "origin", "main"] });
    writeFileSync(path.join(home.repo, "shared.pem"), "same key\n");
    const ownKey = addBranchWorktree({ home, branch: "own-key" });
    writeFileSync(path.join(ownKey, "own.pem"), "only here\n");
    const sharedKey = addBranchWorktree({ home, branch: "shared-key" });
    writeFileSync(path.join(sharedKey, "shared.pem"), "same key\n");
    const packageKey = path.join(sharedKey, "node_modules", "tls-lib", "test", "fixture.pem");
    mkdirSync(path.dirname(packageKey), { recursive: true });
    writeFileSync(packageKey, "test key\n");
    const buildKey = addBranchWorktree({ home, branch: "build-key" });
    mkdirSync(path.join(buildKey, "build"));
    writeFileSync(path.join(buildKey, "build", "signing.p12"), "only in the build folder\n");

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: ownKey })).toMatch(/^kept +risky-files +\//);
    expect(reportLineFor({ report: run.stdout, target: buildKey })).toMatch(/^kept +risky-files +\//);
    expect(reportLineFor({ report: run.stdout, target: sharedKey })).toMatch(/^removed +nothing to push +\//);
    expect(readFileSync(path.join(ownKey, "own.pem"), "utf8")).toBe("only here\n");
  });

  it("keeps a worktree a live session works in, while the ended session's own worktree goes", () => {
    const home = createCodeHome();
    const busy = addBranchWorktree({ home, branch: "busy" });
    const finished = addBranchWorktree({ home, branch: "finished" });
    const configRoot = path.join(home.homeRoot, ".claude");
    mkdirSync(path.join(configRoot, "sessions"), { recursive: true });
    for (const [sessionId, worktree] of [
      [liveSessionId, busy],
      [endedSessionId, finished],
    ]) {
      const registryEntry = { pid: process.pid, sessionId };
      const toolUse = { type: "tool_use", input: { file_path: path.join(worktree, "src", "app.ts") } };
      const transcriptLine = { type: "assistant", cwd: home.repo, message: { content: [toolUse] } };
      writeFileSync(path.join(configRoot, "sessions", `${sessionId}.json`), JSON.stringify(registryEntry));
      appendTranscriptLine({ home, sessionId, transcriptLine });
    }

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: busy })).toMatch(/^kept +in-use +\//);
    expect(reportLineFor({ report: run.stdout, target: finished })).toMatch(/^removed +nothing to push +\//);
    expect(existsSync(busy)).toBe(true);
  });

  it("keeps every worktree while a live session's transcript folder cannot be listed", () => {
    const home = createCodeHome();
    const finished = addBranchWorktree({ home, branch: "finished" });
    const configRoot = path.join(home.homeRoot, ".claude");
    mkdirSync(path.join(configRoot, "sessions"), { recursive: true });
    const registryEntry = { pid: process.pid, sessionId: liveSessionId };
    writeFileSync(path.join(configRoot, "sessions", `${liveSessionId}.json`), JSON.stringify(registryEntry));
    // A folder that links to itself cannot be listed even by root, which ignores file modes.
    const subagentsFolder = path.join(configRoot, "projects", "-app", liveSessionId, "subagents");
    mkdirSync(path.dirname(subagentsFolder), { recursive: true });
    symlinkSync(subagentsFolder, subagentsFolder);

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: finished })).toMatch(/^kept +in-use +\//);
    expect(existsSync(finished)).toBe(true);
  });

  it("keeps a worktree a process holds a file in, or names on its command line, from another folder", async () => {
    const home = createCodeHome();
    const opened = addBranchWorktree({ home, branch: "opened" });
    const named = addBranchWorktree({ home, branch: "named" });
    const holdOpenFile =
      "require('node:fs').openSync(process.env.HELD_FILE, 'r'); console.log('ready'); setInterval(() => {}, 1000);";
    const fileHolder = spawn(process.execPath, ["-e", holdOpenFile], {
      cwd: home.homeRoot,
      env: { ...process.env, HELD_FILE: path.join(opened, "README.md") },
    });
    const folderNamer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", named], { cwd: home.homeRoot });
    try {
      await once(fileHolder.stdout, "data");

      const run = cleanUpAfterSession(home);

      expect(reportLineFor({ report: run.stdout, target: opened })).toMatch(/^kept +in-use +\//);
      expect(reportLineFor({ report: run.stdout, target: named })).toMatch(/^kept +in-use +\//);
    } finally {
      fileHolder.kill();
      folderNamer.kill();
    }
  });

  it("leaves a worktree another session made to that session, while a manual pass looks at it too", () => {
    const home = createCodeHome();
    const othersWorktree = addWorktree({
      home,
      name: "others",
      checkoutOptions: ["-b", "others"],
      startPoint: [],
      creatorId: otherSessionId,
    });

    const sessionRun = cleanUpAfterSession(home);
    const isKeptAfterSession = existsSync(othersWorktree);
    const manualRun = runWatcher({ home, watcherArguments: [] });

    expect(reportLineFor({ report: sessionRun.stdout, target: othersWorktree })).toBe("");
    expect(isKeptAfterSession).toBe(true);
    expect(reportLineFor({ report: manualRun.stdout, target: othersWorktree })).toMatch(
      /^removed +nothing to push +\//,
    );
  });

  it("removes the worktree an ended Codex session made, which its rollout names", () => {
    const home = createCodeHome();
    const codexWorktree = addWorktree({
      home,
      name: "codex-task",
      checkoutOptions: ["-b", "codex-task"],
      startPoint: [],
      creatorId: otherSessionId,
    });
    const rolloutFolder = path.join(home.homeRoot, ".codex", "sessions", "2026", "10", "18");
    const rolloutFile = path.join(rolloutFolder, `rollout-2026-10-18T08-00-00-${codexThreadId}.jsonl`);
    const command = ["/bin/zsh", "-lc", "git worktree add .worktrees/codex-task"];
    const commandItem = { type: "CommandExecution", cwd: `file://${home.repo}`, command };
    const rolloutLine = { type: "event_msg", payload: { type: "item_completed", item: commandItem } };
    mkdirSync(rolloutFolder, { recursive: true });
    writeFileSync(rolloutFile, `${JSON.stringify(rolloutLine)}\n`);

    const run = runWatcher({ home, watcherArguments: ["--session", codexThreadId] });

    expect(reportLineFor({ report: run.stdout, target: codexWorktree })).toMatch(/^removed +nothing to push +\//);
  });

  it("keeps a worktree less than an hour old, even the ended session's own", () => {
    const home = createCodeHome();
    const fresh = addBranchWorktree({ home, branch: "fresh" });
    const now = new Date();
    utimesSync(path.join(fresh, ".git"), now, now);

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: fresh })).toMatch(/^kept +recently-created +\//);
    expect(existsSync(fresh)).toBe(true);
  });

  it("drops git's record of a worktree whose folder is already gone", () => {
    const home = createCodeHome();
    const gone = addBranchWorktree({ home, branch: "gone" });
    rmSync(gone, { recursive: true, force: true });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: gone })).toMatch(/^pruned +folder gone +\//);
    expect(git({ folder: home.repo, command: ["worktree", "list", "--porcelain"] })).not.toContain(gone);
  });

  it("only reports in a dry run", () => {
    const home = createCodeHome();
    const feature = addBranchWorktree({ home, branch: "feature" });
    commitFile({ workTree: feature, fileName: "login.ts" });

    const run = runWatcher({ home, watcherArguments: ["--session", endedSessionId, "--dry-run"] });

    expect(reportLineFor({ report: run.stdout, target: feature })).toMatch(/^would remove +push feature +\//);
    expect(run.stdout).toMatch(/^would run +tool prune +pnpm store prune$/m);
    expect(existsSync(feature)).toBe(true);
    expect(remoteBranches(home)).toBe("main");
    expect(toolCalls(home)).not.toContain("prune");
  });
});

describe("cleanupWatcher waiting", { timeout: 30_000 }, () => {
  it("does not look at the ended session while another watcher holds the lock, and cleans up once it frees", async () => {
    const home = createCodeHome();
    const merged = addBranchWorktree({ home, branch: "merged" });
    const lockFolder = path.join(home.homeRoot, ".codex", "thread-writer-locks");
    const lsofCallsFile = path.join(home.homeRoot, "lsof-calls.log");
    const lsofStub = path.join(home.homeRoot, "stub-tools", "lsof");
    const watcherLock = path.join(home.homeRoot, "disk-cleanup-state", "watcher.lock");
    // An own Codex lock makes every live check list open files, so a check while locked would show in the log.
    mkdirSync(lockFolder, { recursive: true });
    writeFileSync(path.join(lockFolder, `${endedSessionId}.lock`), "");
    writeFileSync(lsofStub, `#!/bin/sh\necho "lsof $*" >> "${lsofCallsFile}"\n`);
    chmodSync(lsofStub, 0o755);
    mkdirSync(path.dirname(watcherLock), { recursive: true });
    writeFileSync(watcherLock, String(process.pid));

    const waiter = spawn(process.execPath, ["--import", "tsx", watcherPath, "--session", endedSessionId, "--wait"], {
      cwd: packageRoot,
      stdio: "ignore",
      env: watcherEnvironment(home),
    });
    const waiterExit = once(waiter, "exit");
    try {
      await delay(3_000);
      const listedFilesWhileLocked = existsSync(lsofCallsFile);
      rmSync(watcherLock);
      await Promise.race([waiterExit, delay(20_000)]);

      expect(listedFilesWhileLocked).toBe(false);
      expect(existsSync(merged)).toBe(false);
    } finally {
      waiter.kill();
    }
  });
});

describe("cleanupWatcher caches", { timeout: 30_000 }, () => {
  const createBuildFolder = (request: {
    readonly home: CodeHome;
    readonly name: string;
    readonly plistEntries: string;
  }) => {
    const buildFolder = path.join(request.home.homeRoot, "Library", "Developer", "Xcode", "DerivedData", request.name);
    mkdirSync(buildFolder, { recursive: true });
    writeFileSync(path.join(buildFolder, "info.plist"), `<plist><dict>${request.plistEntries}</dict></plist>`);
    return buildFolder;
  };

  const workspaceEntry = (workspace: string) => `<key>WorkspacePath</key>\n<string>${workspace}</string>`;

  const createCodexReleases = (home: CodeHome) => {
    const packageFolder = path.join(home.homeRoot, ".codex", "packages", "standalone");
    const oldRelease = path.join(packageFolder, "releases", "0.40.0-aarch64-apple-darwin");
    const currentRelease = path.join(packageFolder, "releases", "0.41.0-aarch64-apple-darwin");
    mkdirSync(oldRelease, { recursive: true });
    mkdirSync(currentRelease, { recursive: true });
    symlinkSync(currentRelease, path.join(packageFolder, "current"));
    utimesSync(oldRelease, MONTH_AGO, MONTH_AGO);
    utimesSync(currentRelease, MONTH_AGO, MONTH_AGO);
    return { oldRelease, currentRelease };
  };

  const createNpxEntry = (request: { readonly home: CodeHome; readonly name: string; readonly touched: Date }) => {
    const npxEntry = path.join(request.home.homeRoot, ".npm", "_npx", request.name);
    mkdirSync(npxEntry, { recursive: true });
    utimesSync(npxEntry, request.touched, request.touched);
    return npxEntry;
  };

  it("deletes unused build folders, old Codex versions, and stale npx packages, then runs each tool's prune", () => {
    const home = createCodeHome();
    const goneWorkspace = workspaceEntry("/nowhere/Gone.xcworkspace");
    const goneProject = createBuildFolder({ home, name: "Gone-abc", plistEntries: goneWorkspace });
    const liveProject = createBuildFolder({ home, name: "App-def", plistEntries: workspaceEntry(home.repo) });
    const escapedFolder = path.join(home.homeRoot, "Tom & Jerry");
    mkdirSync(escapedFolder);
    const escapedWorkspace = workspaceEntry(escapedFolder.replace("&", "&amp;"));
    const escapedProject = createBuildFolder({ home, name: "TomJerry-ghi", plistEntries: escapedWorkspace });
    const unnamedProject = createBuildFolder({ home, name: "Unnamed-jkl", plistEntries: "" });
    // A folder where info.plist belongs cannot be read even by root, which ignores file modes.
    const unreadableProject = path.join(home.homeRoot, "Library", "Developer", "Xcode", "DerivedData", "Odd-mno");
    mkdirSync(path.join(unreadableProject, "info.plist"), { recursive: true });
    const releases = createCodexReleases(home);
    const staleNpx = createNpxEntry({ home, name: "stale", touched: MONTH_AGO });
    const freshNpx = createNpxEntry({ home, name: "fresh", touched: new Date() });

    const run = cleanUpAfterSession(home);

    for (const deleted of [goneProject, releases.oldRelease, staleNpx]) {
      expect(reportLineFor({ report: run.stdout, target: deleted })).toMatch(/^deleted +stale cache +\//);
      expect(existsSync(deleted)).toBe(false);
    }
    const keptEntries = [
      liveProject,
      escapedProject,
      unnamedProject,
      unreadableProject,
      releases.currentRelease,
      freshNpx,
    ];
    expect(keptEntries.every((entry) => existsSync(entry))).toBe(true);
    expect(toolCalls(home)).toContain("xcrun simctl delete unavailable\n");
    expect(toolCalls(home)).toContain("pnpm store prune\n");
    expect(toolCalls(home)).toContain("uv cache prune\n");
    expect(toolCalls(home)).toContain("docker system prune --force --filter until=168h\n");
  });

  it("runs the cache cleanup at most once a day", () => {
    const home = createCodeHome();
    cleanUpAfterSession(home);
    const goneWorkspace = workspaceEntry("/nowhere/Gone.xcworkspace");
    const goneProject = createBuildFolder({ home, name: "Gone-abc", plistEntries: goneWorkspace });
    rmSync(home.toolCallsFile);

    const run = cleanUpAfterSession(home);

    expect(run.stdout).toBe("");
    expect(existsSync(goneProject)).toBe(true);
    expect(toolCalls(home)).toBe("");
  });

  it("looks at no worktree with --caches-only, as after a Grok session, and still cleans the caches", () => {
    const home = createCodeHome();
    const feature = addWorktree({
      home,
      name: "feature",
      checkoutOptions: ["-b", "feature"],
      startPoint: [],
      creatorId: endedSessionId,
    });
    const staleNpx = createNpxEntry({ home, name: "stale", touched: MONTH_AGO });

    const run = runWatcher({ home, watcherArguments: ["--caches-only"] });

    expect(reportLineFor({ report: run.stdout, target: feature })).toBe("");
    expect(existsSync(feature)).toBe(true);
    expect(existsSync(staleNpx)).toBe(false);
  });

  it("skips Docker while its engine is stopped", () => {
    const home = createCodeHome({ dockerRunning: false });

    cleanUpAfterSession(home);

    expect(toolCalls(home)).toContain("pnpm store prune\n");
    expect(toolCalls(home)).not.toContain("docker system");
  });
});
