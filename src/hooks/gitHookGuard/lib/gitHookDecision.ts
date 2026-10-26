import os from "node:os";
import path from "node:path";

import { SHELL_VALUE } from "../../lib/shellSegments.js";
import { commandFactsIn, type GitCall } from "./gitCommands.js";
import type { RepoHooksState } from "./hooksInstalled.js";
import { skipReasonOf } from "./skipsHooks.js";

export type GitHookCheck = {
  readonly command: string;
  readonly startFolder: string;
  readonly inspectRepo: (folder: string) => RepoHooksState;
};

export type GitHookDecision = { readonly _tag: "allow" } | { readonly _tag: "deny"; readonly reason: string };

const ALLOW: GitHookDecision = { _tag: "allow" };

const homeExpanded = (folder: string): string => {
  if (folder === "~") {
    return os.homedir();
  }

  if (folder.startsWith("~/")) {
    return path.join(os.homedir(), folder.slice(2));
  }

  return folder;
};

// A folder that holds a shell value, such as cd "$WORKTREE", is only known when the command runs.
const repoFolderOf = (gitCall: GitCall, startFolder: string): string | undefined => {
  const steps = [gitCall.changedFolder, ...gitCall.repoFolders].filter((step) => step !== undefined);
  if (steps.some((step) => step.includes(SHELL_VALUE))) {
    return undefined;
  }

  return steps.reduce((folder, step) => path.resolve(folder, homeExpanded(step)), startFolder);
};

const missingHooksReason = (repoState: RepoHooksState): string | undefined => {
  if (repoState._tag === "needsInstall") {
    return `git-hook-guard: Git hooks are not installed in this worktree. Run \`${repoState.installCommand}\` in ${repoState.toplevel} first, then retry.`;
  }

  if (repoState._tag === "needsHooksPath") {
    return `git-hook-guard: Run \`git config core.hooksPath .githooks\` in ${repoState.toplevel} first, then retry.`;
  }

  return undefined;
};

export const decideGitHook = (check: GitHookCheck): GitHookDecision => {
  const facts = commandFactsIn(check.command, undefined);
  const skipReason = skipReasonOf(facts);
  if (skipReason !== undefined) {
    return { _tag: "deny", reason: skipReason };
  }

  const hookRunningCalls = facts.gitCalls.filter((gitCall) => ["commit", "push"].includes(gitCall.subcommand));
  const repoFolders = hookRunningCalls.map((gitCall) => repoFolderOf(gitCall, check.startFolder));
  const knownFolders = repoFolders.filter((folder) => folder !== undefined);
  const uninstalledReasons = [...new Set(knownFolders)]
    .map((folder) => missingHooksReason(check.inspectRepo(folder)))
    .filter((reason) => reason !== undefined);
  const [firstReason] = uninstalledReasons;
  if (firstReason === undefined) {
    return ALLOW;
  }

  return { _tag: "deny", reason: firstReason };
};
