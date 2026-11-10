export type WorktreeFacts = {
  readonly inUse: boolean;
  readonly createdRecently: boolean;
  readonly locked: boolean;
  /** Every git question about the worktree was answered. */
  readonly readable: boolean;
  readonly detached: boolean;
  readonly onDefaultBranch: boolean;
  /** The remote said which branch is its default, so a push can tell a feature branch from it. */
  readonly knowsDefaultBranch: boolean;
  readonly hasChanges: boolean;
  readonly hasUnpushedCommits: boolean;
  /** A secret-looking or very large file that must not be pushed, or an ignored secret found nowhere else. */
  readonly hasRiskyFiles: boolean;
  readonly remote: string;
};

type KeepReason =
  | "in-use"
  | "recently-created"
  | "locked"
  | "unreadable"
  | "detached-work"
  | "default-branch-work"
  | "risky-files"
  | "no-remote"
  | "unknown-default-branch";

export type WorktreeCleanupDecision =
  | { readonly _tag: "keep"; readonly reason: KeepReason }
  | { readonly _tag: "remove"; readonly saveChanges: boolean; readonly push: boolean };

const keep = (reason: KeepReason): WorktreeCleanupDecision => ({ _tag: "keep", reason });

// Work left in a worktree is committed and pushed to a branch of the same name before the folder goes. Work that
// has no such branch to go to, or that a live session may still be writing, stays. A worktree another session has just
// made may show no use yet, so one less than an hour old stays too.
export const decideWorktreeCleanup = (facts: WorktreeFacts): WorktreeCleanupDecision => {
  const hasWork = facts.hasChanges || facts.hasUnpushedCommits;

  const isInUse = facts.inUse;
  if (isInUse) {
    return keep("in-use");
  }

  const isCreatedRecently = facts.createdRecently;
  if (isCreatedRecently) {
    return keep("recently-created");
  }

  const isLocked = facts.locked;
  if (isLocked) {
    return keep("locked");
  }

  const isFactsReadableMissing = !facts.readable;
  if (isFactsReadableMissing) {
    return keep("unreadable");
  }

  const isDetachedWithWork = facts.detached && hasWork;
  if (isDetachedWithWork) {
    return keep("detached-work");
  }

  const isOnDefaultBranchWithWork = facts.onDefaultBranch && hasWork;
  if (isOnDefaultBranchWithWork) {
    return keep("default-branch-work");
  }

  if (facts.hasRiskyFiles) {
    return keep("risky-files");
  }

  const hasWorkWithoutRemote = hasWork && !facts.remote;
  if (hasWorkWithoutRemote) {
    return keep("no-remote");
  }

  const hasWorkWithoutDefaultBranch = hasWork && !facts.knowsDefaultBranch;
  if (hasWorkWithoutDefaultBranch) {
    return keep("unknown-default-branch");
  }

  return { _tag: "remove", saveChanges: facts.hasChanges, push: hasWork };
};
