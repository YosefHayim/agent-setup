export interface MergedWorktreeFacts {
  readonly isLocked: boolean;
  readonly isInUse: boolean;
  /** Every git and find question about the worktree was answered. */
  readonly isReadable: boolean;
  /** A file outside node_modules and .git, or in its gitdir apart from index, changed in the last 2 hours. */
  readonly hasRecentChange: boolean;
  readonly hasUncommittedFiles: boolean;
}

type MergedWorktreeKeepReason = "locked" | "in-use" | "unreadable" | "changed-recently" | "uncommitted-files";

export type MergedWorktreeDecision =
  | { readonly _tag: "keep"; readonly reason: MergedWorktreeKeepReason }
  | { readonly _tag: "remove" };

const keep = (reason: MergedWorktreeKeepReason): MergedWorktreeDecision => ({ _tag: "keep", reason });

// Only worktrees whose PR is merged come here, and nothing is saved or pushed first: a worktree that shows any sign of
// work or of use stays for a later pass.
export const decideMergedWorktreeCleanup = (facts: MergedWorktreeFacts): MergedWorktreeDecision => {
  const isLocked = facts.isLocked;
  if (isLocked) {
    return keep("locked");
  }

  const isInUse = facts.isInUse;
  if (isInUse) {
    return keep("in-use");
  }

  const isUnreadable = !facts.isReadable;
  if (isUnreadable) {
    return keep("unreadable");
  }

  const hasRecentChange = facts.hasRecentChange;
  if (hasRecentChange) {
    return keep("changed-recently");
  }

  const hasUncommittedFiles = facts.hasUncommittedFiles;
  if (hasUncommittedFiles) {
    return keep("uncommitted-files");
  }

  return { _tag: "remove" };
};
