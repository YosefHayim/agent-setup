import { isGitFindingNothing, isGitSuccessful, readGitAnswerLines } from "../git-answers.js";
import { pushBranch } from "./branch-push.js";
import type { LinkedWorktree } from "./linked-worktrees.js";

export type WorktreeRemoval =
  | { readonly _tag: "removed"; readonly pushed: boolean }
  | { readonly _tag: "failed"; readonly detail: string };

const SAVE_COMMIT_MESSAGE = "chore: save work left in worktree";
const NOT_SAVED_QUERY = ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"];
const NOT_PUSHED_QUERY = ["log", "HEAD", "--not", "--remotes", "--max-count=1", "--format=%H"];
const HEAD_COMMIT_QUERY = ["rev-parse", "--verify", "HEAD"];

// --no-verify skips commit hooks: the commit only keeps work safe, and a lint failure must not lose it.
const saveChanges = (folder: string): boolean =>
  isGitSuccessful({ folder, query: ["add", "--all"] }) &&
  isGitSuccessful({ folder, query: ["commit", "--no-verify", "--quiet", "--message", SAVE_COMMIT_MESSAGE] });

const readHeadCommit = (folder: string): string => {
  const headLines = readGitAnswerLines({ folder, query: HEAD_COMMIT_QUERY });

  const hasNoHeadLines = !headLines;
  if (hasNoHeadLines) {
    return "";
  }

  return headLines[0];
};

const isSavedAndPushed = (worktree: LinkedWorktree): boolean => {
  const isSaved = isGitFindingNothing({ folder: worktree.folder, query: NOT_SAVED_QUERY });
  const isPushed = worktree.branch === "" || isGitFindingNothing({ folder: worktree.folder, query: NOT_PUSHED_QUERY });
  return isSaved && isPushed;
};

const readFailedPushDetail = (request: {
  readonly worktree: LinkedWorktree;
  readonly remote: string;
  readonly push: boolean;
}): string | undefined => {
  const isRequestPushMissing = !request.push;
  if (isRequestPushMissing) {
    return undefined;
  }

  const { worktree } = request;
  const commit = readHeadCommit(worktree.folder);
  const pushStatus = pushBranch({ folder: worktree.folder, remote: request.remote, branch: worktree.branch, commit });

  const isPushStatus_tagPushed = pushStatus._tag === "pushed";
  if (isPushStatus_tagPushed) {
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

  const hasSaveFailed = request.saveChanges && !saveChanges(worktree.folder);
  if (hasSaveFailed) {
    return { _tag: "failed", detail: "save failed" };
  }

  const pushFailure = readFailedPushDetail(request);

  const hasPushFailure = pushFailure != null;
  if (hasPushFailure) {
    return { _tag: "failed", detail: pushFailure };
  }

  const isNotSavedAndPushed = !isSavedAndPushed(worktree);
  if (isNotSavedAndPushed) {
    return { _tag: "failed", detail: "recheck failed" };
  }

  const removeQuery = ["worktree", "remove", worktree.folder];

  const isRemoveFailed = !isGitSuccessful({ folder: worktree.mainFolder, query: removeQuery });
  if (isRemoveFailed) {
    return { _tag: "failed", detail: "remove failed" };
  }

  return { _tag: "removed", pushed: request.push };
};
