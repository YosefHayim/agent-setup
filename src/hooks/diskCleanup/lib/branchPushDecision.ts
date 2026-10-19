// Facts about a local branch with commits no remote holds.
export type BranchFacts = {
  // It is checked out in the repo's own folder, and a live session or a running process uses that folder.
  readonly inUse: boolean;
  // Every git question about the branch was answered.
  readonly readable: boolean;
  readonly isDefaultBranch: boolean;
  // The remote said which branch is its default, so a push can tell a feature branch from it.
  readonly knowsDefaultBranch: boolean;
  // The unpushed commits bring a secret-looking, oddly named, or very large file.
  readonly hasRiskyFiles: boolean;
  readonly remote: string;
};

export type BranchKeepReason =
  | "in-use"
  | "default-branch-work"
  | "no-remote"
  | "unknown-default-branch"
  | "unreadable"
  | "risky-files";

export type BranchPushDecision =
  | { readonly _tag: "keep"; readonly reason: BranchKeepReason }
  | { readonly _tag: "push" };

const keep = (reason: BranchKeepReason): BranchPushDecision => ({ _tag: "keep", reason });

// A branch's unpushed commits go to a branch of the same name. The default branch stays, and so does a branch a live
// session may still be committing to, or one with no feature branch of its own to go to.
export const decideBranchPush = (facts: BranchFacts): BranchPushDecision => {
  if (facts.inUse) {
    return keep("in-use");
  }

  if (facts.isDefaultBranch) {
    return keep("default-branch-work");
  }

  if (!facts.remote) {
    return keep("no-remote");
  }

  if (!facts.knowsDefaultBranch) {
    return keep("unknown-default-branch");
  }

  if (!facts.readable) {
    return keep("unreadable");
  }

  if (facts.hasRiskyFiles) {
    return keep("risky-files");
  }

  return { _tag: "push" };
};
