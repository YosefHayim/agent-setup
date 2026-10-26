import { gitAnswerLines, gitFindsNothing, gitSucceeds } from "../../lib/gitAnswers.js";
import { pushBranch } from "./branchPush.js";
import type { LinkedWorktree } from "./linkedWorktrees.js";

export type WorktreeRemoval =
  | { readonly _tag: "removed"; readonly pushed: boolean }
  | { readonly _tag: "failed"; readonly detail: string };

const SAVE_COMMIT_MESSAGE = "chore: save work left in worktree";
const NOT_SAVED_QUERY = ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"];
const NOT_PUSHED_QUERY = ["log", "HEAD", "--not", "--remotes", "--max-count=1", "--format=%H"];
const HEAD_COMMIT_QUERY = ["rev-parse", "--verify", "HEAD"];

// --no-verify skips commit hooks: the commit only keeps work safe, and a lint failure must not lose it.
const saveChanges = (folder: string): boolean =>
  gitSucceeds({ folder, query: ["add", "--all"] }) &&
  gitSucceeds({ folder, query: ["commit", "--no-verify", "--quiet", "--message", SAVE_COMMIT_MESSAGE] });

const headCommit = (folder: string): string => {
  const headLines = gitAnswerLines({ folder, query: HEAD_COMMIT_QUERY });
  if (!headLines) {
    return "";
  }

  return headLines[0];
};

const isSavedAndPushed = (worktree: LinkedWorktree): boolean => {
  const isSaved = gitFindsNothing({ folder: worktree.folder, query: NOT_SAVED_QUERY });
  const isPushed = worktree.branch === "" || gitFindsNothing({ folder: worktree.folder, query: NOT_PUSHED_QUERY });
  return isSaved && isPushed;
};

const failedPushDetail = (request: {
  readonly worktree: LinkedWorktree;
  readonly remote: string;
  readonly push: boolean;
}): string | undefined => {
  if (!request.push) {
    return undefined;
  }

  const { worktree } = request;
  const commit = headCommit(worktree.folder);
  const pushStatus = pushBranch({ folder: worktree.folder, remote: request.remote, branch: worktree.branch, commit });
  if (pushStatus._tag === "pushed") {
    return undefined;
  }

  return `push failed: ${pushStatus.reason}`;
};

// Without --force, git itself refuses to remove a worktree with changes or submodules; ignored files go with it.
export const removeWorktree = (request: {
  readonly worktree: LinkedWorktree;
  readonly remote: string;
  readonly saveChanges: boolean;
  readonly push: boolean;
}): WorktreeRemoval => {
  const { worktree } = request;
  if (request.saveChanges && !saveChanges(worktree.folder)) {
    return { _tag: "failed", detail: "save failed" };
  }

  const pushFailure = failedPushDetail(request);
  if (pushFailure !== undefined) {
    return { _tag: "failed", detail: pushFailure };
  }

  if (!isSavedAndPushed(worktree)) {
    return { _tag: "failed", detail: "recheck failed" };
  }

  const removeQuery = ["worktree", "remove", worktree.folder];
  if (!gitSucceeds({ folder: worktree.mainFolder, query: removeQuery })) {
    return { _tag: "failed", detail: "remove failed" };
  }

  return { _tag: "removed", pushed: request.push };
};
