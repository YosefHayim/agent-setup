import { describe, expect, it } from "vitest";

import { decideGitHook } from "./gitHookDecision.js";
import type { RepoHooksState } from "./hooksInstalled.js";

const READY: RepoHooksState = { _tag: "ready" };
const START_FOLDER = "/work/app";

const decide = (command: string, repoStates: Readonly<Record<string, RepoHooksState>> = {}) =>
  decideGitHook({
    command,
    startFolder: START_FOLDER,
    inspectRepo: (folder) => repoStates[folder] || READY,
  });

const denies = (command: string) => expect(decide(command)._tag, command).toBe("deny");

const allows = (command: string) => expect(decide(command)._tag, command).toBe("allow");

describe("decideGitHook skipped hooks", () => {
  it("denies --no-verify after commit or push", () => {
    denies("git commit --no-verify -m fix");
    denies('git commit -m "fix" --no-verify');
    denies("git push --no-verify");
    denies("git push origin main --no-verify");
    denies("git -C ../app push --no-verify");
    denies("/usr/bin/git push --no-verify");
    denies("git commit --no-veri -m fix");
  });

  it("denies git commit -n, alone or inside a flag cluster", () => {
    denies("git commit -n -m fix");
    denies('git commit -m "fix" -n');
    denies("git commit -an");
    denies('git commit -anm "msg"');
    denies("git commit -nm fix");
    denies("git commit --amend -n");
  });

  it("allows commit flags where n belongs to a value", () => {
    allows("git commit -mn");
    allows("git commit -m n");
    allows("git commit -m -n");
    allows('git commit -am "-n"');
    allows("git commit -uno -m fix");
    allows("git commit --message -n");
    allows("git commit --message=-n");
  });

  it("allows git push -n, which is a dry run", () => {
    allows("git push -n");
    allows("git push -n origin main");
    allows("git push --dry-run");
  });

  it("denies HUSKY=0 as a prefix, an export, or an env argument", () => {
    denies("HUSKY=0 git push");
    denies("HUSKY=0 pnpm install");
    denies("export HUSKY=0 && git push");
    denies("export HUSKY=0; git commit -m fix");
    denies("env HUSKY=0 git push");
    denies("env -i HUSKY=0 git push");
    denies("FOO=1 HUSKY=0 git push");
  });

  it("allows HUSKY set to another value", () => {
    allows("HUSKY=1 git push");
    allows("HUSKY=0.5 git push");
  });

  it("denies inline hooks path overrides on any git command", () => {
    denies("git -c core.hooksPath=/dev/null commit -m fix");
    denies("git -c core.hookspath=/dev/null push");
    denies("git -c CORE.HOOKSPATH=. push");
    denies('git -c "core.hooksPath=/dev/null" push');
    denies("git --config-env=core.hooksPath=OTHER_HOOKS push");
    denies("git --config-env core.hooksPath=OTHER_HOOKS push");
    denies("GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" git push");
    denies("GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git push");
    denies("export GIT_CONFIG_KEY_3=Core.HooksPath; git push");
  });

  it("allows other inline config and other config variables", () => {
    allows("git -c user.name=agent commit -m fix");
    allows("GIT_CONFIG_KEY_0=user.name git commit -m fix");
    allows("git --config-env=user.name=NAME commit -m fix");
  });

  it("denies git config that sets or unsets core.hooksPath to anything but the repo hooks", () => {
    denies("git config core.hooksPath /dev/null");
    denies("git config --local core.hookspath ~/hooks");
    denies("git config core.hooksPath ''");
    denies('git config core.hooksPath ""');
    denies("git config --unset core.hooksPath");
    denies("git config --unset-all core.hooksPath");
    denies("git config unset core.hooksPath");
    denies("git config set core.hooksPath /dev/null");
    denies("git config --add core.hooksPath other");
    denies("git -C ../app config core.hooksPath /dev/null");
  });

  it("allows git config that points hooks at .husky/_ or .githooks, and reads", () => {
    allows("git config core.hooksPath .husky/_");
    allows("git config core.hooksPath ./.husky/_/");
    allows("git config core.hooksPath .githooks");
    allows("git config --local core.hooksPath .githooks");
    allows("git config core.hooksPath");
    allows("git config --get core.hooksPath");
    allows("git config get core.hooksPath");
    allows("git config user.name agent");
    allows("git config --file other.cfg user.name agent");
  });

  it("allows text that only mentions the flags", () => {
    allows('git commit -m "block --no-verify"');
    allows("git commit -m 'never run HUSKY=0 git push'");
    allows("grep -e --no-verify file");
    allows("echo HUSKY=0");
    allows('echo "git push --no-verify"');
    allows("grep -rn 'core.hooksPath' src");
    allows("git log --grep=--no-verify");
    allows("git commit -m fix -- --no-verify");
  });

  it("finds skipped hooks inside chained commands, pipes, substitutions and shell strings", () => {
    denies("pnpm test && git push --no-verify");
    denies("pnpm test; git commit -n -m fix");
    denies("echo done | git push --no-verify");
    denies("pnpm test || git push --no-verify");
    denies("echo $(git commit -n -m fix)");
    denies('bash -c "git push --no-verify"');
    denies("sh -c 'git commit -an -m fix'");
    denies('zsh -lc "cd app && git push --no-verify"');
    denies('eval "git push --no-verify"');
    denies('bash -c "HUSKY=0 git push"');
    allows('bash -c "git push"');
    allows('bash -c "echo --no-verify"');
  });
});

describe("decideGitHook uninstalled hooks", () => {
  const needsInstall: RepoHooksState = { _tag: "needsInstall", toplevel: "/work/app", installCommand: "pnpm install" };

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
    const states = { "/other/repo": needsInstall, "/work/app/sub": needsInstall };
    expect(decide("git -C /other/repo push", states)._tag).toBe("deny");
    expect(decide("cd /other/repo && git push", states)._tag).toBe("deny");
    expect(decide("cd /elsewhere; cd /other/repo; git push", states)._tag).toBe("deny");
    expect(decide("cd sub && git push", states)._tag).toBe("deny");
    expect(decide("cd /other/repo && git -C ../app push", states)._tag).toBe("allow");
    expect(decide("git push", states)._tag).toBe("allow");
    expect(decide("cd /elsewhere && git push", states)._tag).toBe("allow");
    expect(decide('bash -c "cd /other/repo && git push"', states)._tag).toBe("deny");
  });

  it("allows a folder that is only known when the command runs", () => {
    const states = { "/work/app": needsInstall };
    expect(decide('cd "$WORKTREE" && git push', states)._tag).toBe("allow");
    expect(decide('git -C "$WORKTREE" push', states)._tag).toBe("allow");
  });
});
