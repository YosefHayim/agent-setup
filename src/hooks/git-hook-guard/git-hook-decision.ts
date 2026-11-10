import os from "node:os";
import path from "node:path";

import { SHELL_FIELD } from "../shell-segments.js";
import { type GitCall, readCommandFactsIn } from "./git-commands.js";
import type { RepoHooksStatus } from "./hooks-installed.js";
import { skipReasonOf } from "./skips-hooks.js";

export type GitHookCheck = {
  readonly command: string;
  readonly startFolder: string;
  readonly inspectRepo: (folder: string) => RepoHooksStatus;
};

export type GitHookDecision = { readonly _tag: "allow" } | { readonly _tag: "deny"; readonly reason: string };

const ALLOW: GitHookDecision = { _tag: "allow" };

const readHomeExpanded = (folder: string): string => {
  const isHomeFolder = folder === "~";
  if (isHomeFolder) {
    return os.homedir();
  }

  const isHomeSubfolder = folder.startsWith("~/");
  if (isHomeSubfolder) {
    return path.join(os.homedir(), folder.slice(2));
  }

  return folder;
};

// A folder that holds a shell value, such as cd "$WORKTREE", is only known when the command runs.
const readRepoFolder = (gitCall: GitCall, startFolder: string): string | null => {
  const steps = [gitCall.changedFolder, ...gitCall.repoFolders].filter((step) => step != null);

  const hasShellStep = steps.some((step) => step.includes(SHELL_FIELD));
  if (hasShellStep) {
    return null;
  }

  return steps.reduce((folder, step) => path.resolve(folder, readHomeExpanded(step)), startFolder);
};

const readMissingHooksReason = (repoStatus: RepoHooksStatus): string | null => {
  const isInstallNeeded = repoStatus._tag === "needsInstall";
  if (isInstallNeeded) {
    return `git-hook-guard: Git hooks are not installed in this worktree. Run \`${repoStatus.installCommand}\` in ${repoStatus.toplevel} first, then retry.`;
  }

  const isHooksPathNeeded = repoStatus._tag === "needsHooksPath";
  if (isHooksPathNeeded) {
    return `git-hook-guard: Run \`git config core.hooksPath .githooks\` in ${repoStatus.toplevel} first, then retry.`;
  }

  return null;
};

export const decideGitHook = (check: GitHookCheck): GitHookDecision => {
  const facts = readCommandFactsIn(check.command, null);
  const skipReason = skipReasonOf(facts);

  const hasSkipReason = skipReason != null;
  if (hasSkipReason) {
    return { _tag: "deny", reason: skipReason };
  }

  const hookRunningCalls = facts.gitCalls.filter((gitCall) => ["commit", "push"].includes(gitCall.subcommand));
  const repoFolders = hookRunningCalls.map((gitCall) => readRepoFolder(gitCall, check.startFolder));
  const knownFolders = repoFolders.filter((folder) => folder != null);
  const uninstalledReasons = [...new Set(knownFolders)]
    .map((folder) => readMissingHooksReason(check.inspectRepo(folder)))
    .filter((reason) => reason != null);
  const [firstReason] = uninstalledReasons;

  const isFirstReasonMissing = firstReason == null;
  if (isFirstReasonMissing) {
    return ALLOW;
  }

  return { _tag: "deny", reason: firstReason };
};
