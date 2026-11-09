import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const commandPath = fileURLToPath(new URL("./clear-scratch.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(commandPath), "../../../..");
const sessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const otherSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const threadId = "01a0e4bf-1e83-7532-9119-d78525246a31";
const workspaces: Array<string> = [];

const createHomeRoot = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-clear-command-"));
  workspaces.push(homeRoot);
  return homeRoot;
};

const claudeSessionFolder = (request: { readonly homeRoot: string; readonly sessionId: string }) =>
  path.join(request.homeRoot, "claude-scratch", `claude-${process.getuid?.()}`, "-Users-me-repo", request.sessionId);

const writeScratchFile = (file: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "scratch\n");
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

const runCommand = (request: { readonly homeRoot: string; readonly sessionArgument: string }) =>
  spawnSync(process.execPath, ["--import", "tsx", commandPath, request.sessionArgument], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: request.homeRoot,
      CLAUDE_CONFIG_DIR: path.join(request.homeRoot, ".claude"),
      CLAUDE_CODE_TMPDIR: path.join(request.homeRoot, "claude-scratch"),
      CODEX_HOME: path.join(request.homeRoot, ".codex"),
    },
  });

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("clearScratch process boundary", () => {
  it("empties the session's scratchpad and leaves its task output and other sessions alone", () => {
    const homeRoot = createHomeRoot();
    const sessionFolder = claudeSessionFolder({ homeRoot, sessionId });
    const otherSessionFolder = claudeSessionFolder({ homeRoot, sessionId: otherSessionId });
    writeScratchFile(path.join(sessionFolder, "scratchpad", "probe.sh"));
    writeScratchFile(path.join(sessionFolder, "scratchpad", "runs", "e2e.log"));
    writeScratchFile(path.join(sessionFolder, "tasks", "b1.output"));
    writeScratchFile(path.join(otherSessionFolder, "scratchpad", "notes.txt"));

    const execution = runCommand({ homeRoot, sessionArgument: sessionId });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe(`Cleared ${path.join(sessionFolder, "scratchpad")}\n`);
    expect(readdirSync(path.join(sessionFolder, "scratchpad"))).toEqual([]);
    expect(existsSync(path.join(sessionFolder, "tasks", "b1.output"))).toBe(true);
    expect(existsSync(path.join(otherSessionFolder, "scratchpad", "notes.txt"))).toBe(true);
  });

  it("empties the scratch folder a Codex thread named after itself", () => {
    const homeRoot = createHomeRoot();
    const threadFolder = path.join(homeRoot, ".codex", "scratchpads", threadId);
    const namedFolder = path.join(homeRoot, ".codex", "scratchpads", "release-notes-draft");
    writeScratchFile(path.join(threadFolder, "probe.log"));
    writeScratchFile(path.join(namedFolder, "draft.md"));

    const execution = runCommand({ homeRoot, sessionArgument: threadId });

    expect(execution.status).toBe(0);
    expect(readdirSync(threadFolder)).toEqual([]);
    expect(existsSync(path.join(namedFolder, "draft.md"))).toBe(true);
  });

  it("keeps a git work tree with uncommitted work, names it, and deletes the throwaway files around it", () => {
    const homeRoot = createHomeRoot();
    const scratchpad = path.join(claudeSessionFolder({ homeRoot, sessionId }), "scratchpad");
    const workTree = path.join(scratchpad, "checks", "feature-clone");
    writeScratchFile(path.join(scratchpad, "probe.sh"));
    writeScratchFile(path.join(scratchpad, "checks", "run.log"));
    const initializationStatus = createRepositoryWithUncommittedWork(workTree);

    const execution = runCommand({ homeRoot, sessionArgument: sessionId });

    expect(initializationStatus).toBe(0);
    expect(execution.status).toBe(0);
    expect(execution.stdout).toContain(`Kept ${workTree}: it holds git work that is not committed and pushed.`);
    expect(existsSync(path.join(workTree, "feature.ts"))).toBe(true);
    expect(readdirSync(scratchpad)).toEqual(["checks"]);
    expect(readdirSync(path.join(scratchpad, "checks"))).toEqual(["feature-clone"]);
  });

  it("leaves a scratchpad that is itself a git work tree with uncommitted work, and does not call it cleared", () => {
    const homeRoot = createHomeRoot();
    const scratchpad = path.join(claudeSessionFolder({ homeRoot, sessionId }), "scratchpad");
    const initializationStatus = createRepositoryWithUncommittedWork(scratchpad);

    const execution = runCommand({ homeRoot, sessionArgument: sessionId });

    expect(initializationStatus).toBe(0);
    expect(execution.status).toBe(0);
    expect(execution.stdout).not.toContain("Cleared");
    expect(execution.stdout).toContain(`Kept ${scratchpad}:`);
    expect(existsSync(path.join(scratchpad, "feature.ts"))).toBe(true);
  });

  it("refuses an argument that is not a session ID and deletes nothing", () => {
    const homeRoot = createHomeRoot();
    const scratchFile = path.join(claudeSessionFolder({ homeRoot, sessionId }), "scratchpad", "probe.sh");
    writeScratchFile(scratchFile);

    const execution = runCommand({ homeRoot, sessionArgument: path.dirname(scratchFile) });

    expect(execution.status).toBe(1);
    expect(execution.stderr).toBe("usage: clearScratch <session-id>\n");
    expect(existsSync(scratchFile)).toBe(true);
  });

  it("says so when the session has no scratch folder", () => {
    const execution = runCommand({ homeRoot: createHomeRoot(), sessionArgument: sessionId });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("No scratch folder to clear.\n");
  });
});
