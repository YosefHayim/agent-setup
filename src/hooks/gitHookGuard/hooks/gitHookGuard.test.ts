import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./gitHookGuard.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workspaces: Array<string> = [];

// A commit runs the pre-commit hook with GIT_DIR and GIT_INDEX_FILE set, which would send these git calls to this repo.
const environmentWithoutGit = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

const runGit = (folder: string, gitArguments: ReadonlyArray<string>) =>
  spawnSync("git", ["-C", folder, ...gitArguments], { encoding: "utf8", env: environmentWithoutGit });

const createFolder = (): string => {
  const workspace = mkdtempSync(path.join(packageRoot, "scratch-git-hook-guard-"));
  workspaces.push(workspace);
  return realpathSync(workspace);
};

const createRepo = (): string => {
  const repoFolder = createFolder();
  runGit(repoFolder, ["init", "--quiet"]);
  return repoFolder;
};

const runHookWith = (hookInput: unknown) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    input: JSON.stringify(hookInput),
    encoding: "utf8",
    env: environmentWithoutGit,
  });

const runHook = (command: string, cwd: string) => runHookWith({ tool_name: "Bash", cwd, tool_input: { command } });

const denialReason = (stdout: string): string => {
  const output: { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } } =
    JSON.parse(stdout);
  expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  return output.hookSpecificOutput.permissionDecisionReason;
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("gitHookGuard process boundary", () => {
  it("fails open with clean stdout when hook input is malformed", () => {
    const execution = spawnSync(process.execPath, ["--import", "tsx", hookPath], { input: "{", encoding: "utf8" });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("denies a push when core.hooksPath names a husky folder that does not exist", () => {
    const repoFolder = createRepo();
    runGit(repoFolder, ["config", "core.hooksPath", ".husky/_"]);
    writeFileSync(path.join(repoFolder, "pnpm-lock.yaml"), "");

    const execution = runHook("git push", repoFolder);

    expect(execution.status).toBe(0);
    expect(denialReason(execution.stdout)).toBe(
      `git-hook-guard: Git hooks are not installed in this worktree. Run \`pnpm install\` in ${repoFolder} first, then retry.`,
    );
  });

  it("names npm when the repo has only a package-lock.json", () => {
    const repoFolder = createRepo();
    runGit(repoFolder, ["config", "core.hooksPath", ".husky/_"]);
    writeFileSync(path.join(repoFolder, "package-lock.json"), "{}");

    const execution = runHook("git commit -m fix", repoFolder);

    expect(denialReason(execution.stdout)).toContain(`Run \`npm install\` in ${repoFolder}`);
  });

  it("allows a push once the husky folder exists", () => {
    const repoFolder = createRepo();
    runGit(repoFolder, ["config", "core.hooksPath", ".husky/_"]);
    mkdirSync(path.join(repoFolder, ".husky", "_"), { recursive: true });

    const execution = runHook("git push", repoFolder);

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("allows a push in a repo with no hooks", () => {
    const repoFolder = createRepo();

    const execution = runHook("git push", repoFolder);

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("allows a push outside any git repo", () => {
    const folder = createFolder();

    const execution = runHook("git push", folder);

    expect(execution.stdout).toBe("");
  });

  it("denies a push when .husky exists but core.hooksPath is unset", () => {
    const repoFolder = createRepo();
    mkdirSync(path.join(repoFolder, ".husky"));

    const execution = runHook("git push", repoFolder);

    expect(denialReason(execution.stdout)).toContain(`Run \`pnpm install\` in ${repoFolder} first, then retry.`);
  });

  it("denies a push when .githooks exists but core.hooksPath is unset, and allows it once set", () => {
    const repoFolder = createRepo();
    mkdirSync(path.join(repoFolder, ".githooks"));

    const execution = runHook("git push", repoFolder);

    expect(denialReason(execution.stdout)).toBe(
      `git-hook-guard: Run \`git config core.hooksPath .githooks\` in ${repoFolder} first, then retry.`,
    );

    runGit(repoFolder, ["config", "core.hooksPath", ".githooks"]);
    expect(runHook("git push", repoFolder).stdout).toBe("");
  });

  it("finds the repo from git -C and from cd in the same command", () => {
    const repoFolder = createRepo();
    mkdirSync(path.join(repoFolder, ".githooks"));
    const elsewhere = createFolder();

    expect(denialReason(runHook(`git -C ${repoFolder} push`, elsewhere).stdout)).toContain(repoFolder);
    expect(denialReason(runHook(`cd ${repoFolder} && git push`, elsewhere).stdout)).toContain(repoFolder);
  });

  it("denies --no-verify in a repo whose hooks are installed", () => {
    const repoFolder = createRepo();

    const execution = runHook("git push --no-verify", repoFolder);

    expect(denialReason(execution.stdout)).toContain("Fix what they report instead of skipping them.");
  });

  it("reads the Codex cmd field", () => {
    const repoFolder = createRepo();

    const execution = runHookWith({ cwd: repoFolder, tool_input: { cmd: "git commit -n -m fix" } });

    expect(denialReason(execution.stdout)).toContain("skipping them");
  });
});
