import { describe, expect, it } from "vitest";

import { decideGitHook } from "./git-hook-decision.js";
import type { RepoHooksStatus } from "./hooks-installed.js";

const READY: RepoHooksStatus = { _tag: "ready" };
const START_FOLDER = "/work/app";

const decide = (command: string, repoStatuses: Readonly<Record<string, RepoHooksStatus>> = {}) =>
  decideGitHook({
    command,
    startFolder: START_FOLDER,
    inspectRepo: (folder) => repoStatuses[folder] || READY,
  });

const runDenies = (command: string) => expect(decide(command)._tag, command).toBe("deny");

const runAllows = (command: string) => expect(decide(command)._tag, command).toBe("allow");

describe("decideGitHook skipped hooks", () => {
  it("denies --no-verify after commit or push", () => {
    runDenies("git commit --no-verify -m fix");
    runDenies('git commit -m "fix" --no-verify');
    runDenies("git push --no-verify");
    runDenies("git push origin main --no-verify");
    runDenies("git -C ../app push --no-verify");
    runDenies("/usr/bin/git push --no-verify");
    runDenies("git commit --no-veri -m fix");
  });

  it("denies git commit -n, alone or inside a flag cluster", () => {
    runDenies("git commit -n -m fix");
    runDenies('git commit -m "fix" -n');
    runDenies("git commit -an");
    runDenies('git commit -anm "msg"');
    runDenies("git commit -nm fix");
    runDenies("git commit --amend -n");
  });

  it("allows commit flags where n belongs to a value", () => {
    runAllows("git commit -mn");
    runAllows("git commit -m n");
    runAllows("git commit -m -n");
    runAllows('git commit -am "-n"');
    runAllows("git commit -uno -m fix");
    runAllows("git commit --message -n");
    runAllows("git commit --message=-n");
  });

  it("allows git push -n, which is a dry run", () => {
    runAllows("git push -n");
    runAllows("git push -n origin main");
    runAllows("git push --dry-run");
  });

  it("denies HUSKY=0 as a prefix, an export, or an env argument", () => {
    runDenies("HUSKY=0 git push");
    runDenies("HUSKY=0 pnpm install");
    runDenies("export HUSKY=0 && git push");
    runDenies("export HUSKY=0; git commit -m fix");
    runDenies("env HUSKY=0 git push");
    runDenies("env -i HUSKY=0 git push");
    runDenies("FOO=1 HUSKY=0 git push");
  });

  it("allows HUSKY set to another value", () => {
    runAllows("HUSKY=1 git push");
    runAllows("HUSKY=0.5 git push");
  });

  it("denies inline hooks path overrides on any git command", () => {
    runDenies("git -c core.hooksPath=/dev/null commit -m fix");
    runDenies("git -c core.hookspath=/dev/null push");
    runDenies("git -c CORE.HOOKSPATH=. push");
    runDenies('git -c "core.hooksPath=/dev/null" push');
    runDenies("git --config-env=core.hooksPath=OTHER_HOOKS push");
    runDenies("git --config-env core.hooksPath=OTHER_HOOKS push");
    runDenies("GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" git push");
    runDenies("GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push");
    runDenies("export GIT_CONFIG_KEY_3=Core.HooksPath; git push");
  });

  it("allows other inline config and other config variables", () => {
    runAllows("git -c user.name=agent commit -m fix");
    runAllows("GIT_CONFIG_KEY_0=user.name git commit -m fix");
    runAllows("git --config-env=user.name=NAME commit -m fix");
  });

  it("denies git config that sets or unsets core.hooksPath to anything but the repo hooks", () => {
    runDenies("git config core.hooksPath /dev/null");
    runDenies("git config --local core.hookspath ~/hooks");
    runDenies("git config core.hooksPath ''");
    runDenies('git config core.hooksPath ""');
    runDenies("git config --unset core.hooksPath");
    runDenies("git config --unset-all core.hooksPath");
    runDenies("git config unset core.hooksPath");
    runDenies("git config set core.hooksPath /dev/null");
    runDenies("git config --add core.hooksPath other");
    runDenies("git -C ../app config core.hooksPath /dev/null");
  });

  it("allows git config that points hooks at .husky/_ or .githooks, and reads", () => {
    runAllows("git config core.hooksPath .husky/_");
    runAllows("git config core.hooksPath ./.husky/_/");
    runAllows("git config core.hooksPath .githooks");
    runAllows("git config --local core.hooksPath .githooks");
    runAllows("git config core.hooksPath");
    runAllows("git config --get core.hooksPath");
    runAllows("git config get core.hooksPath");
    runAllows("git config user.name agent");
    runAllows("git config --file other.cfg user.name agent");
  });

  it("allows text that only mentions the flags", () => {
    runAllows('git commit -m "block --no-verify"');
    runAllows("git commit -m 'never run HUSKY=0 git push'");
    runAllows("grep -e --no-verify file");
    runAllows("echo HUSKY=0");
    runAllows('echo "git push --no-verify"');
    runAllows("grep -rn 'core.hooksPath' src");
    runAllows("git log --grep=--no-verify");
    runAllows("git commit -m fix -- --no-verify");
  });

  it("finds skipped hooks inside chained commands, pipes, substitutions and shell strings", () => {
    runDenies("pnpm test && git push --no-verify");
    runDenies("pnpm test; git commit -n -m fix");
    runDenies("echo done | git push --no-verify");
    runDenies("pnpm test || git push --no-verify");
    runDenies("echo $(git commit -n -m fix)");
    runDenies('bash -c "git push --no-verify"');
    runDenies("sh -c 'git commit -an -m fix'");
    runDenies('zsh -lc "cd app && git push --no-verify"');
    runDenies('eval "git push --no-verify"');
    runDenies('bash -c "HUSKY=0 git push"');
    runAllows('bash -c "git push"');
    runAllows('bash -c "echo --no-verify"');
  });
});

describe("decideGitHook uninstalled hooks", () => {
  const needsInstall: RepoHooksStatus = { _tag: "needsInstall", toplevel: "/work/app", installCommand: "pnpm install" };

  it("denies a push and a commit when the hooks are not installed, naming the install command", () => {
    const pushDecision = decide("git push", { "/work/app": needsInstall });
    expect(pushDecision).toEqual({
      _tag: "deny",
      reason:
        "git-hook-guard: Git hooks are not installed in this worktree. Run `pnpm install` in /work/app first, then retry.",
    });
    expect(decide("git commit -m fix", { "/work/app": needsInstall })._tag).toBe("deny");
  });

  it("denies with the githooks command when core.hooksPath is not set", () => {
    const decision = decide("git push", { "/work/app": { _tag: "needsHooksPath", toplevel: "/work/app" } });
    expect(decision).toEqual({
      _tag: "deny",
      reason: "git-hook-guard: Run `git config core.hooksPath .githooks` in /work/app first, then retry.",
    });
  });

  it("does not look at the repo for commands that run no hooks", () => {
    expect(decide("git status && git log", { "/work/app": needsInstall })._tag).toBe("allow");
    expect(decide("echo git push", { "/work/app": needsInstall })._tag).toBe("allow");
  });

  it("finds the repo from git -C, the last cd, or the start folder", () => {
    const statuses = { "/other/repo": needsInstall, "/work/app/sub": needsInstall };
    expect(decide("git -C /other/repo push", statuses)._tag).toBe("deny");
    expect(decide("cd /other/repo && git push", statuses)._tag).toBe("deny");
    expect(decide("cd /elsewhere; cd /other/repo; git push", statuses)._tag).toBe("deny");
    expect(decide("cd sub && git push", statuses)._tag).toBe("deny");
    expect(decide("cd /other/repo && git -C ../app push", statuses)._tag).toBe("allow");
    expect(decide("git push", statuses)._tag).toBe("allow");
    expect(decide("cd /elsewhere && git push", statuses)._tag).toBe("allow");
    expect(decide('bash -c "cd /other/repo && git push"', statuses)._tag).toBe("deny");
  });

  it("allows a folder that is only known when the command runs", () => {
    const states = { "/work/app": needsInstall };
    expect(decide('cd "$WORKTREE" && git push', states)._tag).toBe("allow");
    expect(decide('git -C "$WORKTREE" push', states)._tag).toBe("allow");
  });
});
