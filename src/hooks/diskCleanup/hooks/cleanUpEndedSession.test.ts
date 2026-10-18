import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./cleanUpEndedSession.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(hookPath), "../../../..");
const endedSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
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

// ~/Desktop/Code/app with one two-hour-old feature worktree holding a commit its remote lacks, which the ended
// session's transcript names.
const createFeatureWorktree = () => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-disk-cleanup-hook-"));
  workspaces.push(homeRoot);
  writeFileSync(path.join(homeRoot, ".gitconfig"), "[user]\n\tname = Cleanup Test\n\temail = cleanup@example.test\n");
  const remote = path.join(homeRoot, "remotes", "app.git");
  const repo = path.join(homeRoot, "Desktop", "Code", "app");
  const feature = path.join(repo, ".worktrees", "feature");
  mkdirSync(remote, { recursive: true });
  git({ folder: remote, command: ["init", "--quiet", "--bare"] });
  git({ folder: homeRoot, command: ["clone", "--quiet", remote, repo] });
  git({ folder: repo, command: ["commit", "--quiet", "--allow-empty", "--message", "start"] });
  git({ folder: repo, command: ["push", "--quiet", "origin", "main"] });
  git({ folder: repo, command: ["remote", "set-head", "origin", "main"] });
  git({ folder: repo, command: ["worktree", "add", "--quiet", "-b", "feature", feature] });
  git({ folder: feature, command: ["commit", "--quiet", "--allow-empty", "--message", "feature work"] });
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1_000);
  utimesSync(path.join(feature, ".git"), twoHoursAgo, twoHoursAgo);
  const projectFolder = path.join(homeRoot, ".claude", "projects", "-app");
  const toolUse = { type: "tool_use", name: "Bash", input: { command: "git worktree add .worktrees/feature" } };
  const transcriptLine = { type: "assistant", cwd: repo, message: { content: [toolUse] } };
  mkdirSync(projectFolder, { recursive: true });
  writeFileSync(path.join(projectFolder, `${endedSessionId}.jsonl`), `${JSON.stringify(transcriptLine)}\n`);
  return { homeRoot, remote, feature };
};

// The prune tools are stubbed to fail their readiness check, so the cache cleanup never touches the real ones.
const writeStoppedPruneTools = (homeRoot: string) => {
  const stubsFolder = path.join(homeRoot, "stub-tools");
  mkdirSync(stubsFolder);
  for (const tool of ["xcrun", "pnpm", "uv", "docker"]) {
    writeFileSync(path.join(stubsFolder, tool), "#!/bin/sh\nexit 1\n");
    chmodSync(path.join(stubsFolder, tool), 0o755);
  }
  return stubsFolder;
};

const runHook = (request: { readonly homeRoot: string; readonly hookInput: string }) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    cwd: packageRoot,
    input: request.hookInput,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: request.homeRoot,
      PATH: `${writeStoppedPruneTools(request.homeRoot)}:${process.env.PATH}`,
      CLAUDE_CONFIG_DIR: path.join(request.homeRoot, ".claude"),
      CODEX_HOME: path.join(request.homeRoot, ".codex"),
      AGENT_SETUP_DISK_CLEANUP_STATE_DIR: path.join(request.homeRoot, "disk-cleanup-state"),
    },
  });

const waitUntilGone = async (entry: string) => {
  for (let attempt = 0; attempt < 60 && existsSync(entry); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("cleanUpEndedSession process boundary", { timeout: 30_000 }, () => {
  it("hands the ended session to the watcher, which pushes and removes the finished worktree", async () => {
    const { homeRoot, remote, feature } = createFeatureWorktree();

    const execution = runHook({ homeRoot, hookInput: JSON.stringify({ session_id: endedSessionId }) });
    await waitUntilGone(feature);
    // The watcher holds its lock until it is done, so the workspace is only removed after it exits.
    await waitUntilGone(path.join(homeRoot, "disk-cleanup-state", "watcher.lock"));

    expect(execution.status).toBe(0);
    expect(existsSync(feature)).toBe(false);
    expect(git({ folder: remote, command: ["log", "--format=%s", "feature"] })).toContain("feature work");
  });

  it("starts no watcher for a session whose ID is not a UUID, as Grok's are, since it owns no worktree", async () => {
    const { homeRoot, feature } = createFeatureWorktree();

    const execution = runHook({ homeRoot, hookInput: JSON.stringify({ session_id: "../grok-session" }) });
    // A watcher would have taken its lock, in the state folder, well within this time.
    await delay(3_000);

    expect(execution.status).toBe(0);
    expect(existsSync(path.join(homeRoot, "disk-cleanup-state"))).toBe(false);
    expect(existsSync(feature)).toBe(true);
  });

  it("exits cleanly on input that is not JSON", () => {
    const { homeRoot } = createFeatureWorktree();

    expect(runHook({ homeRoot, hookInput: "not json" }).status).toBe(0);
  });
});
