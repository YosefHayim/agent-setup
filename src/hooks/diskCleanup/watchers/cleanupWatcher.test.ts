import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const watcherPath = fileURLToPath(new URL("./cleanupWatcher.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(watcherPath), "../../../..");
// Spotlight and editors index and open files in the repo folder, and the watcher counts any open file as a folder in use.
const scratchParent = realpathSync(tmpdir());
const endedSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const liveSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const otherSessionId = "0b6f1d2e-3c4a-4e5f-8a9b-1c2d3e4f5a6b";
const laterSessionId = "9e8d7c6b-5a49-4382-a716-5f4e3d2c1b0a";
const codexThreadId = "019a2c41-7d3e-7b10-9c2a-5e4f6a7b8c9d";
const PRUNE_TOOLS = ["xcrun", "pnpm", "uv", "docker"];
const MONTH_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1_000);
const realGitPath = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
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

// Each stub logs its call. Docker is stubbed too, so a call to it would show.
const writePruneToolStubs = (homeRoot: string) => {
  const stubsFolder = path.join(homeRoot, "stub-tools");
  const toolCallsFile = path.join(homeRoot, "tool-calls.log");
  mkdirSync(stubsFolder);
  for (const tool of PRUNE_TOOLS) {
    const stub = path.join(stubsFolder, tool);
    writeFileSync(stub, `#!/bin/sh\necho "${tool} $*" >> "${toolCallsFile}"\n`);
    chmodSync(stub, 0o755);
  }
  return toolCallsFile;
};

// A fake home with ~/Desktop/Code/app, cloned from a bare remote outside the code folders.
const createCodeHome = (): CodeHome => {
  const homeRoot = mkdtempSync(path.join(scratchParent, "disk-cleanup-"));
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
  const toolCallsFile = writePruneToolStubs(homeRoot);
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

const runWatcher = (request: {
  readonly home: CodeHome;
  readonly watcherArguments: ReadonlyArray<string>;
  readonly extraEnvironment?: NodeJS.ProcessEnv;
}) =>
  spawnSync(process.execPath, ["--import", "tsx", watcherPath, ...request.watcherArguments], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...watcherEnvironment(request.home), ...request.extraEnvironment },
  });

// A folder that links to itself cannot be listed even by root, which ignores file modes.
const linkToItself = (folder: string) => {
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(folder, folder);
};

// Moving a folder to another disk and linking it back leaves git naming the worktrees made before by their old paths,
// which now run through the link, and the ones made after by their real paths, while lsof names every open file by its
// real path.
const moveAndLinkBack = (request: { readonly folder: string; readonly movedFolder: string }) => {
  mkdirSync(path.dirname(request.movedFolder), { recursive: true });
  renameSync(request.folder, request.movedFolder);
  symlinkSync(request.movedFolder, request.folder);
};

const HOLD_OPEN_FILE =
  "require('node:fs').openSync(process.env.HELD_FILE, 'r'); console.log('ready'); setInterval(() => {}, 1000);";

// The holder prints a line once the file is open.
const holdFileOpen = (request: { readonly home: CodeHome; readonly heldFile: string }) =>
  spawn(process.execPath, ["-e", HOLD_OPEN_FILE], {
    cwd: request.home.homeRoot,
    env: { ...process.env, HELD_FILE: request.heldFile },
  });

const cleanUpAfterSession = (home: CodeHome) => runWatcher({ home, watcherArguments: ["--session", endedSessionId] });

// The session edits a file in the repo's own folder, which names the repo and none of its worktrees.
const workInRepo = (request: { readonly home: CodeHome; readonly sessionId: string }) => {
  const toolUse = { type: "tool_use", input: { file_path: path.join(request.home.repo, "src", "app.ts") } };
  const transcriptLine = { type: "assistant", cwd: request.home.repo, message: { content: [toolUse] } };
  appendTranscriptLine({ home: request.home, sessionId: request.sessionId, transcriptLine });
};

const registerLiveSession = (request: { readonly home: CodeHome; readonly sessionId: string }) => {
  const sessionsFolder = path.join(request.home.homeRoot, ".claude", "sessions");
  const registryEntry = { pid: process.pid, sessionId: request.sessionId };
  mkdirSync(sessionsFolder, { recursive: true });
  writeFileSync(path.join(sessionsFolder, `${request.sessionId}.json`), JSON.stringify(registryEntry));
};

// The branch gets one commit of its own, and the repo's folder goes back to main.
const addBranch = (request: { readonly home: CodeHome; readonly branch: string; readonly fileName: string }) => {
  git({ folder: request.home.repo, command: ["switch", "--quiet", "--create", request.branch] });
  commitFile({ workTree: request.home.repo, fileName: request.fileName });
  git({ folder: request.home.repo, command: ["switch", "--quiet", "main"] });
};

const remoteSubjects = (request: { readonly home: CodeHome; readonly branch: string }): string =>
  git({ folder: request.home.remote, command: ["log", "--format=%s", request.branch] });

const cleanupLogFile = (home: CodeHome): string => path.join(home.homeRoot, "disk-cleanup-state", "cleanup.log");

// Stands in for git on the watcher's path, and first runs the shell step for each call whose arguments hold the words.
const interceptGit = (request: { readonly home: CodeHome; readonly words: string; readonly step: string }): string => {
  const gitStub = path.join(request.home.homeRoot, "stub-tools", "git");
  const stubLines = [
    "#!/bin/sh",
    `case " $* " in *" ${request.words} "*) ${request.step} ;; esac`,
    `exec "${realGitPath}" "$@"`,
  ];
  writeFileSync(gitStub, `${stubLines.join("\n")}\n`);
  chmodSync(gitStub, 0o755);
  return gitStub;
};

const refuseEveryPush = (home: CodeHome) => {
  const hookFile = path.join(home.repo, ".git", "hooks", "pre-push");
  writeFileSync(hookFile, '#!/bin/sh\necho "tests failed" >&2\nexit 1\n');
  chmodSync(hookFile, 0o755);
};

const upstreamOf = (request: { readonly home: CodeHome; readonly branch: string }): string =>
  git({ folder: request.home.repo, command: ["rev-parse", "--abbrev-ref", `${request.branch}@{upstream}`] });

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
    expect(upstreamOf({ home, branch: "feature" })).toBe("origin/feature");
  });

  it("keeps a worktree whose push the pre-push hook refuses, and says why", () => {
    const home = createCodeHome();
    const feature = addBranchWorktree({ home, branch: "feature" });
    commitFile({ workTree: feature, fileName: "login.ts" });
    refuseEveryPush(home);

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: feature })).toMatch(
      /^kept +push failed: pre-push hook failed +\//,
    );
    expect(existsSync(feature)).toBe(true);
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
    const withUpperKey = addBranchWorktree({ home, branch: "with-upper-key" });
    writeFileSync(path.join(withUpperKey, "Signing.PEM"), "private key\n");
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
    expect(reportLineFor({ report: run.stdout, target: withUpperKey })).toMatch(/^kept +risky-files +\//);
    expect(reportLineFor({ report: run.stdout, target: committedKey })).toMatch(/^kept +risky-files +\//);
    expect(reportLineFor({ report: run.stdout, target: locked })).toMatch(/^kept +locked +\//);
    const keptFolders = [detached, onMain, withKey, withUpperKey, committedKey, locked];
    expect(keptFolders.every((folder) => existsSync(folder))).toBe(true);
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

  it("keeps an ignored secret file the main worktree lacks, whatever the case of its name, and drops one it holds too", () => {
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
    const upperBuildKey = addBranchWorktree({ home, branch: "upper-build-key" });
    mkdirSync(path.join(upperBuildKey, "build"));
    writeFileSync(path.join(upperBuildKey, "build", "Signing.P12"), "only in the build folder\n");

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: ownKey })).toMatch(/^kept +risky-files +\//);
    expect(reportLineFor({ report: run.stdout, target: buildKey })).toMatch(/^kept +risky-files +\//);
    expect(reportLineFor({ report: run.stdout, target: upperBuildKey })).toMatch(/^kept +risky-files +\//);
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
    linkToItself(path.join(configRoot, "projects", "-app", liveSessionId, "subagents"));

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: finished })).toMatch(/^kept +in-use +\//);
    expect(existsSync(finished)).toBe(true);
  });

  it("keeps every worktree while the Codex lock folder cannot be listed", () => {
    const home = createCodeHome();
    const finished = addBranchWorktree({ home, branch: "finished" });
    linkToItself(path.join(home.homeRoot, ".codex", "thread-writer-locks"));

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: finished })).toMatch(/^kept +in-use +\//);
    expect(existsSync(finished)).toBe(true);
  });

  it("keeps every worktree while the session registry cannot be listed", () => {
    const home = createCodeHome();
    const finished = addBranchWorktree({ home, branch: "finished" });
    linkToItself(path.join(home.homeRoot, ".claude", "sessions"));

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: finished })).toMatch(/^kept +in-use +\//);
    expect(existsSync(finished)).toBe(true);
  });

  it("keeps a worktree a process holds a file in, or names on its command line, from another folder", async () => {
    const home = createCodeHome();
    const opened = addBranchWorktree({ home, branch: "opened" });
    const named = addBranchWorktree({ home, branch: "named" });
    const fileHolder = holdFileOpen({ home, heldFile: path.join(opened, "README.md") });
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

  it("keeps a worktree a process uses by its real path, after its code folder was moved and linked back", async () => {
    const home = createCodeHome();
    const opened = addBranchWorktree({ home, branch: "opened" });
    const named = addBranchWorktree({ home, branch: "named" });
    moveAndLinkBack({ folder: path.dirname(home.repo), movedFolder: path.join(home.homeRoot, "Volumes", "Code") });
    const namedRealFolder = realpathSync(named);
    const fileHolder = holdFileOpen({ home, heldFile: path.join(opened, "README.md") });
    const folderNamer = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", namedRealFolder], {
      cwd: home.homeRoot,
    });
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

  it("keeps a worktree a live session or job works in by its real path, after its code folder was moved and linked back", () => {
    const home = createCodeHome();
    const busy = addBranchWorktree({ home, branch: "busy" });
    const jobbed = addBranchWorktree({ home, branch: "jobbed" });
    const finished = addBranchWorktree({ home, branch: "finished" });
    moveAndLinkBack({ folder: path.dirname(home.repo), movedFolder: path.join(home.homeRoot, "Volumes", "Code") });
    const configRoot = path.join(home.homeRoot, ".claude");
    const busyRealFolder = realpathSync(busy);
    const registryEntry = { pid: process.pid, sessionId: liveSessionId };
    mkdirSync(path.join(configRoot, "sessions"), { recursive: true });
    writeFileSync(path.join(configRoot, "sessions", `${liveSessionId}.json`), JSON.stringify(registryEntry));
    const toolUse = { type: "tool_use", input: { file_path: path.join(busyRealFolder, "src", "app.ts") } };
    const transcriptLine = { type: "assistant", cwd: home.repo, message: { content: [toolUse] } };
    appendTranscriptLine({ home, sessionId: liveSessionId, transcriptLine });
    const jobbedRealFolder = realpathSync(jobbed);
    const jobFolder = path.join(configRoot, "jobs", "nightly-build");
    const jobState = { sessionId: otherSessionId, state: "working", cwd: jobbedRealFolder };
    mkdirSync(jobFolder, { recursive: true });
    writeFileSync(path.join(jobFolder, "state.json"), JSON.stringify(jobState));

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: busy })).toMatch(/^kept +in-use +\//);
    expect(reportLineFor({ report: run.stdout, target: jobbed })).toMatch(/^kept +in-use +\//);
    expect(reportLineFor({ report: run.stdout, target: finished })).toMatch(/^removed +nothing to push +\//);
    expect(existsSync(busy)).toBe(true);
    expect(existsSync(jobbed)).toBe(true);
  });

  it("cleans up worktrees made under a linked code folder, and keeps one a live session works in through the link", () => {
    const home = createCodeHome();
    moveAndLinkBack({ folder: path.dirname(home.repo), movedFolder: path.join(home.homeRoot, "Volumes", "Code") });
    const busy = addBranchWorktree({ home, branch: "busy" });
    const finished = addBranchWorktree({ home, branch: "finished" });
    const configRoot = path.join(home.homeRoot, ".claude");
    const registryEntry = { pid: process.pid, sessionId: liveSessionId };
    mkdirSync(path.join(configRoot, "sessions"), { recursive: true });
    writeFileSync(path.join(configRoot, "sessions", `${liveSessionId}.json`), JSON.stringify(registryEntry));
    const toolUse = { type: "tool_use", input: { file_path: path.join(busy, "src", "app.ts") } };
    const transcriptLine = { type: "assistant", cwd: home.repo, message: { content: [toolUse] } };
    appendTranscriptLine({ home, sessionId: liveSessionId, transcriptLine });
    const busyRealFolder = realpathSync(busy);
    const finishedRealFolder = realpathSync(finished);

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: busyRealFolder })).toMatch(/^kept +in-use +\//);
    expect(reportLineFor({ report: run.stdout, target: finishedRealFolder })).toMatch(/^removed +nothing to push +\//);
    expect(existsSync(busy)).toBe(true);
    expect(existsSync(finished)).toBe(false);
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

  it("looks again at a worktree an earlier session's end kept, at a later session's end", () => {
    const home = createCodeHome();
    const fresh = addBranchWorktree({ home, branch: "fresh" });
    const now = new Date();
    utimesSync(path.join(fresh, ".git"), now, now);
    const endedRun = cleanUpAfterSession(home);
    utimesSync(path.join(fresh, ".git"), TWO_HOURS_AGO, TWO_HOURS_AGO);

    const laterRun = runWatcher({ home, watcherArguments: ["--session", otherSessionId] });

    expect(reportLineFor({ report: endedRun.stdout, target: fresh })).toMatch(/^kept +recently-created +\//);
    expect(reportLineFor({ report: laterRun.stdout, target: fresh })).toMatch(/^removed +nothing to push +\//);
    expect(existsSync(fresh)).toBe(false);
  });

  it("reports a repo whose worktrees git cannot list, and still looks again at the ones kept before", () => {
    const home = createCodeHome();
    const fresh = addBranchWorktree({ home, branch: "fresh" });
    const now = new Date();
    utimesSync(path.join(fresh, ".git"), now, now);
    const endedRun = cleanUpAfterSession(home);
    workInRepo({ home, sessionId: otherSessionId });
    const gitStub = interceptGit({ home, words: "worktree list", step: "exit 1" });

    const unreadableRun = runWatcher({ home, watcherArguments: ["--session", otherSessionId] });
    rmSync(gitStub);
    utimesSync(path.join(fresh, ".git"), TWO_HOURS_AGO, TWO_HOURS_AGO);
    const laterRun = runWatcher({ home, watcherArguments: ["--session", otherSessionId] });

    expect(reportLineFor({ report: endedRun.stdout, target: fresh })).toMatch(/^kept +recently-created +\//);
    expect(reportLineFor({ report: unreadableRun.stdout, target: home.repo })).toMatch(
      /^kept +worktree list failed +\//,
    );
    expect(reportLineFor({ report: unreadableRun.stdout, target: fresh })).toBe("");
    expect(reportLineFor({ report: laterRun.stdout, target: fresh })).toMatch(/^removed +nothing to push +\//);
    expect(existsSync(fresh)).toBe(false);
  });

  it("does not take a worktree made later in a kept worktree's folder, for another branch, for the kept one", () => {
    const home = createCodeHome();
    const fresh = addBranchWorktree({ home, branch: "fresh" });
    const now = new Date();
    utimesSync(path.join(fresh, ".git"), now, now);
    const endedRun = cleanUpAfterSession(home);
    git({ folder: home.repo, command: ["worktree", "remove", "--force", fresh] });
    addWorktree({ home, name: "fresh", checkoutOptions: ["-b", "remade"], startPoint: [], creatorId: otherSessionId });

    const laterRun = runWatcher({ home, watcherArguments: ["--session", laterSessionId] });

    expect(reportLineFor({ report: endedRun.stdout, target: fresh })).toMatch(/^kept +recently-created +\//);
    expect(reportLineFor({ report: laterRun.stdout, target: fresh })).toBe("");
    expect(existsSync(fresh)).toBe(true);
  });

  it("leaves a kept list it cannot read as it is, and still cleans up", () => {
    const home = createCodeHome();
    const feature = addBranchWorktree({ home, branch: "feature" });
    mkdirSync(path.join(home.homeRoot, "disk-cleanup-state", "kept-worktrees"), { recursive: true });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: feature })).toMatch(/^removed +nothing to push +\//);
  });

  it("drops git's record of a worktree whose folder is already gone", () => {
    const home = createCodeHome();
    const gone = addBranchWorktree({ home, branch: "gone" });
    rmSync(gone, { recursive: true, force: true });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: gone })).toMatch(/^pruned +folder gone +\//);
    expect(git({ folder: home.repo, command: ["worktree", "list", "--porcelain"] })).not.toContain(gone);
  });

  it("drops git's record of a worktree whose folder is gone, though it was outside the code folders", () => {
    const home = createCodeHome();
    const outside = path.join(home.homeRoot, "scratch", "outside");
    git({ folder: home.repo, command: ["worktree", "add", "--quiet", "-b", "outside", outside] });
    rmSync(outside, { recursive: true, force: true });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: outside })).toMatch(/^pruned +folder gone +\//);
    expect(git({ folder: home.repo, command: ["worktree", "list", "--porcelain"] })).not.toContain(outside);
  });

  it("keeps the record of a locked worktree whose folder is gone", () => {
    const home = createCodeHome();
    const gone = addBranchWorktree({ home, branch: "gone" });
    git({ folder: home.repo, command: ["worktree", "lock", gone] });
    rmSync(gone, { recursive: true, force: true });

    const run = cleanUpAfterSession(home);

    expect(run.stdout).not.toMatch(/^pruned/m);
    expect(git({ folder: home.repo, command: ["worktree", "list", "--porcelain"] })).toContain(gone);
  });

  it("does not take a file the unpushed commits added and deleted for a risky one, but still keeps a large committed file", () => {
    const home = createCodeHome();
    const addedAndDeleted = addBranchWorktree({ home, branch: "added-and-deleted" });
    commitFile({ workTree: addedAndDeleted, fileName: "scratch.ts" });
    git({ folder: addedAndDeleted, command: ["rm", "--quiet", "scratch.ts"] });
    git({ folder: addedAndDeleted, command: ["commit", "--quiet", "--message", "remove scratch.ts"] });
    const large = addBranchWorktree({ home, branch: "large" });
    writeFileSync(path.join(large, "model.bin"), Buffer.alloc(50 * 1024 * 1024 + 1));
    git({ folder: large, command: ["add", "model.bin"] });
    git({ folder: large, command: ["commit", "--quiet", "--message", "add model.bin"] });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: addedAndDeleted })).toMatch(
      /^removed +pushed added-and-deleted +\//,
    );
    expect(reportLineFor({ report: run.stdout, target: large })).toMatch(/^kept +risky-files +\//);
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
    expect(existsSync(cleanupLogFile(home))).toBe(false);
  });
});

describe("cleanupWatcher branches", { timeout: 30_000 }, () => {
  it("pushes an unpushed branch no worktree has checked out to a branch of the same name", () => {
    const home = createCodeHome();
    addBranch({ home, branch: "login", fileName: "login.ts" });
    workInRepo({ home, sessionId: endedSessionId });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: `${home.repo} login` })).toMatch(/^pushed +to origin +\//);
    expect(remoteSubjects({ home, branch: "login" })).toBe("add login.ts\nadd README.md");
    expect(upstreamOf({ home, branch: "login" })).toBe("origin/login");
  });

  it("pushes the commit whose files it checked, while one committed during the push waits for a later pass", () => {
    const home = createCodeHome();
    git({ folder: home.repo, command: ["switch", "--quiet", "--create", "current"] });
    commitFile({ workTree: home.repo, fileName: "current.ts" });
    workInRepo({ home, sessionId: endedSessionId });
    const keyCommit = [
      `echo key > "${home.repo}/server.key"`,
      `"${realGitPath}" -C "${home.repo}" add server.key`,
      `"${realGitPath}" -C "${home.repo}" commit --quiet --message "add server.key"`,
    ].join(" && ");
    interceptGit({ home, words: "push", step: keyCommit });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: `${home.repo} current` })).toMatch(/^pushed +to origin +\//);
    expect(remoteSubjects({ home, branch: "current" })).toBe("add current.ts\nadd README.md");
    const unpushedSubjects = git({
      folder: home.repo,
      command: ["log", "--format=%s", "current", "--not", "--remotes"],
    });
    expect(unpushedSubjects).toBe("add server.key");
  });

  it("reports a repo whose branches git cannot list", () => {
    const home = createCodeHome();
    addBranch({ home, branch: "login", fileName: "login.ts" });
    workInRepo({ home, sessionId: endedSessionId });
    interceptGit({ home, words: "for-each-ref", step: "exit 1" });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: home.repo })).toMatch(/^kept +branch list failed +\//);
    expect(remoteBranches(home)).toBe("main");
  });

  it("keeps unpushed work on the default branch, and branches that bring files that must not be pushed", () => {
    const home = createCodeHome();
    commitFile({ workTree: home.repo, fileName: "hotfix.ts" });
    addBranch({ home, branch: "committed-key", fileName: "server.key" });
    addBranch({ home, branch: "committed-upper-key", fileName: "Server.KEY" });
    git({ folder: home.repo, command: ["switch", "--quiet", "--create", "large-file"] });
    writeFileSync(path.join(home.repo, "model.bin"), Buffer.alloc(50 * 1024 * 1024 + 1));
    git({ folder: home.repo, command: ["add", "model.bin"] });
    git({ folder: home.repo, command: ["commit", "--quiet", "--message", "add model.bin"] });
    git({ folder: home.repo, command: ["switch", "--quiet", "main"] });
    workInRepo({ home, sessionId: endedSessionId });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: `${home.repo} main` })).toMatch(
      /^kept +default-branch-work +\//,
    );
    expect(reportLineFor({ report: run.stdout, target: `${home.repo} committed-key` })).toMatch(
      /^kept +risky-files +\//,
    );
    expect(reportLineFor({ report: run.stdout, target: `${home.repo} committed-upper-key` })).toMatch(
      /^kept +risky-files +\//,
    );
    expect(reportLineFor({ report: run.stdout, target: `${home.repo} large-file` })).toMatch(/^kept +risky-files +\//);
    expect(remoteBranches(home)).toBe("main");
    expect(remoteSubjects({ home, branch: "main" })).toBe("add README.md");
  });

  it("leaves a branch checked out in a worktree to the worktree pass", () => {
    const home = createCodeHome();
    const othersWorktree = addWorktree({
      home,
      name: "others",
      checkoutOptions: ["-b", "others"],
      startPoint: [],
      creatorId: otherSessionId,
    });
    commitFile({ workTree: othersWorktree, fileName: "others.ts" });
    workInRepo({ home, sessionId: endedSessionId });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: `${home.repo} others` })).toBe("");
    expect(remoteBranches(home)).toBe("main");
  });

  it("looks at a repo's branches once, though a worktree of it sits straight in a code folder", () => {
    const home = createCodeHome();
    addBranch({ home, branch: "login", fileName: "login.ts" });
    const sibling = path.join(path.dirname(home.repo), "app-sibling");
    git({ folder: home.repo, command: ["worktree", "add", "--quiet", "-b", "sibling", sibling] });
    commitFile({ workTree: sibling, fileName: "sibling.ts" });

    const run = runWatcher({ home, watcherArguments: [] });

    expect(run.stdout.match(/ login$/gm)).toHaveLength(1);
    expect(reportLineFor({ report: run.stdout, target: sibling })).toMatch(/^kept +recently-created +\//);
    expect(reportLineFor({ report: run.stdout, target: `${sibling} sibling` })).toBe("");
    expect(remoteBranches(home)).toBe("login\nmain");
  });

  it("leaves a repo the ended session never named, while a manual pass pushes its branches", () => {
    const home = createCodeHome();
    addBranch({ home, branch: "login", fileName: "login.ts" });

    const sessionRun = cleanUpAfterSession(home);
    const remoteAfterSession = remoteBranches(home);
    const manualRun = runWatcher({ home, watcherArguments: [] });

    expect(reportLineFor({ report: sessionRun.stdout, target: `${home.repo} login` })).toBe("");
    expect(remoteAfterSession).toBe("main");
    expect(reportLineFor({ report: manualRun.stdout, target: `${home.repo} login` })).toMatch(/^pushed +to origin +\//);
  });

  it("keeps the branch checked out in the repo's folder while a live session works there, and pushes it after", () => {
    const home = createCodeHome();
    git({ folder: home.repo, command: ["switch", "--quiet", "--create", "current"] });
    commitFile({ workTree: home.repo, fileName: "current.ts" });
    workInRepo({ home, sessionId: endedSessionId });
    workInRepo({ home, sessionId: liveSessionId });
    registerLiveSession({ home, sessionId: liveSessionId });

    const busyRun = cleanUpAfterSession(home);
    rmSync(path.join(home.homeRoot, ".claude", "sessions", `${liveSessionId}.json`));
    const freeRun = cleanUpAfterSession(home);

    expect(reportLineFor({ report: busyRun.stdout, target: `${home.repo} current` })).toMatch(/^kept +in-use +\//);
    expect(reportLineFor({ report: freeRun.stdout, target: `${home.repo} current` })).toMatch(/^pushed +to origin +\//);
    expect(git({ folder: home.repo, command: ["branch", "--show-current"] })).toBe("current");
  });

  it("keeps a branch whose remote branch has moved on, since the push is never forced, and says why", () => {
    const home = createCodeHome();
    addBranch({ home, branch: "login", fileName: "login.ts" });
    git({ folder: home.repo, command: ["push", "--quiet", "origin", "login"] });
    git({ folder: home.repo, command: ["switch", "--quiet", "login"] });
    git({ folder: home.repo, command: ["commit", "--quiet", "--amend", "--message", "rework login"] });
    git({ folder: home.repo, command: ["switch", "--quiet", "main"] });
    workInRepo({ home, sessionId: endedSessionId });

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: `${home.repo} login` })).toMatch(
      /^kept +push failed: remote moved on +\//,
    );
    expect(remoteSubjects({ home, branch: "login" })).toBe("add login.ts\nadd README.md");
  });

  it("keeps a branch whose pre-push hook refuses the push, and says the hook failed", () => {
    const home = createCodeHome();
    addBranch({ home, branch: "login", fileName: "login.ts" });
    workInRepo({ home, sessionId: endedSessionId });
    refuseEveryPush(home);

    const run = cleanUpAfterSession(home);

    expect(reportLineFor({ report: run.stdout, target: `${home.repo} login` })).toMatch(
      /^kept +push failed: pre-push hook failed +\//,
    );
    expect(remoteBranches(home)).toBe("main");
  });

  it("only reports in a dry run", () => {
    const home = createCodeHome();
    addBranch({ home, branch: "login", fileName: "login.ts" });
    workInRepo({ home, sessionId: endedSessionId });

    const run = runWatcher({ home, watcherArguments: ["--session", endedSessionId, "--dry-run"] });

    expect(reportLineFor({ report: run.stdout, target: `${home.repo} login` })).toMatch(/^would push +to origin +\//);
    expect(remoteBranches(home)).toBe("main");
  });
});

describe("cleanupWatcher log", { timeout: 30_000 }, () => {
  it("does not log a line again while a target's last logged action and detail are the same", () => {
    const home = createCodeHome();
    const locked = addBranchWorktree({ home, branch: "locked" });
    commitFile({ workTree: locked, fileName: "locked.ts" });
    git({ folder: home.repo, command: ["worktree", "lock", locked] });

    cleanUpAfterSession(home);
    const secondRun = cleanUpAfterSession(home);
    git({ folder: home.repo, command: ["worktree", "unlock", locked] });
    cleanUpAfterSession(home);

    const lockedLines = readFileSync(cleanupLogFile(home), "utf8")
      .split("\n")
      .filter((line) => line.endsWith(` ${locked}`));
    expect(reportLineFor({ report: secondRun.stdout, target: locked })).toMatch(/^kept +locked +\//);
    expect(lockedLines).toHaveLength(2);
    expect(lockedLines[0]).toMatch(/ kept +locked +\//);
    expect(lockedLines[1]).toMatch(/ removed +pushed locked +\//);
  });

  it("adds each pass's report after when it ran, and keeps only the latest thousand lines", () => {
    const home = createCodeHome();
    const earlierLines = Array.from({ length: 1_000 }, (_, lineNumber) => `earlier line ${lineNumber}`);
    mkdirSync(path.dirname(cleanupLogFile(home)), { recursive: true });
    writeFileSync(cleanupLogFile(home), `${earlierLines.join("\n")}\n`);
    addBranchWorktree({ home, branch: "feature" });

    const run = cleanUpAfterSession(home);

    const reportLines = run.stdout.split("\n").filter(Boolean);
    const logLines = readFileSync(cleanupLogFile(home), "utf8").split("\n").filter(Boolean);
    const passLines = logLines.slice(-reportLines.length);
    expect(reportLines.length).toBeGreaterThan(1);
    expect(logLines).toHaveLength(1_000);
    expect(logLines[0]).toBe(`earlier line ${reportLines.length}`);
    expect(passLines.every((line) => /^\d{4}-\d\d-\d\dT\S+Z /.test(line))).toBe(true);
    expect(passLines.map((line) => line.slice(line.indexOf(" ") + 1))).toEqual(reportLines);
  });
});

describe("cleanupWatcher waiting", { timeout: 30_000 }, () => {
  it("logs that it gave up waiting for an ended session that still looks live", () => {
    const home = createCodeHome();
    registerLiveSession({ home, sessionId: endedSessionId });

    const run = runWatcher({
      home,
      watcherArguments: ["--session", endedSessionId, "--wait"],
      extraEnvironment: { AGENT_SETUP_DISK_CLEANUP_WAIT_LIMIT_MILLISECONDS: "500" },
    });

    const logLines = readFileSync(cleanupLogFile(home), "utf8").split("\n").filter(Boolean);
    expect(run.status).toBe(0);
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toMatch(new RegExp(`^\\S+ gave up +wait limit reached +session ${endedSessionId}$`));
  });

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
    expect(toolCalls(home)).not.toContain("docker");
  });

  it("keeps a stale npx package a process holds a file in, after the npm folder was moved and linked back", async () => {
    const home = createCodeHome();
    const heldNpx = createNpxEntry({ home, name: "held", touched: MONTH_AGO });
    const heldFile = path.join(heldNpx, "package.json");
    writeFileSync(heldFile, "{}\n");
    utimesSync(heldNpx, MONTH_AGO, MONTH_AGO);
    const staleNpx = createNpxEntry({ home, name: "stale", touched: MONTH_AGO });
    moveAndLinkBack({
      folder: path.join(home.homeRoot, ".npm"),
      movedFolder: path.join(home.homeRoot, "Volumes", "npm"),
    });
    const fileHolder = holdFileOpen({ home, heldFile });
    try {
      await once(fileHolder.stdout, "data");

      const run = cleanUpAfterSession(home);

      expect(reportLineFor({ report: run.stdout, target: staleNpx })).toMatch(/^deleted +stale cache +\//);
      expect(reportLineFor({ report: run.stdout, target: heldNpx })).toBe("");
      expect(existsSync(heldNpx)).toBe(true);
    } finally {
      fileHolder.kill();
    }
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
});
