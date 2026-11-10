export type BranchFacts = {
  // It is checked out in a folder that still exists, and a live session or a running process uses that folder.
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

type BranchKeepReason =
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
  const isInUse = facts.inUse;
  if (isInUse) {
    return keep("in-use");
  }

  if (facts.isDefaultBranch) {
    return keep("default-branch-work");
  }

  const isFactsRemoteMissing = !facts.remote;
  if (isFactsRemoteMissing) {
    return keep("no-remote");
  }

  const isFactsKnowsDefaultBranchMissing = !facts.knowsDefaultBranch;
  if (isFactsKnowsDefaultBranchMissing) {
    return keep("unknown-default-branch");
  }

  const isFactsReadableMissing = !facts.readable;
  if (isFactsReadableMissing) {
    return keep("unreadable");
  }

  if (facts.hasRiskyFiles) {
    return keep("risky-files");
  }

  return { _tag: "push" };
};
