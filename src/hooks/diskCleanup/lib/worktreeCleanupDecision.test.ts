import { describe, expect, it } from "vitest";

import { decideWorktreeCleanup, type WorktreeFacts } from "./worktreeCleanupDecision.js";

const finishedFeature: WorktreeFacts = {
  inUse: false,
  createdRecently: false,
  locked: false,
  readable: true,
  detached: false,
  onDefaultBranch: false,
  knowsDefaultBranch: true,
  hasChanges: false,
  hasUnpushedCommits: false,
  hasRiskyFiles: false,
  remote: "origin",
};

describe("decideWorktreeCleanup", () => {
  it("removes a worktree whose work is all pushed, with nothing to save or push", () => {
    expect(decideWorktreeCleanup(finishedFeature)).toEqual({ _tag: "remove", saveChanges: false, push: false });
  });

  it("saves and pushes work left on a feature branch before removing it", () => {
    expect(decideWorktreeCleanup({ ...finishedFeature, hasChanges: true })).toEqual({
      _tag: "remove",
      saveChanges: true,
      push: true,
    });
    expect(decideWorktreeCleanup({ ...finishedFeature, hasUnpushedCommits: true })).toEqual({
      _tag: "remove",
      saveChanges: false,
      push: true,
    });
  });

  it.each([
    [{ inUse: true, createdRecently: true }, "in-use"],
    [{ createdRecently: true, locked: true }, "recently-created"],
    [{ locked: true, readable: false }, "locked"],
    [{ readable: false }, "unreadable"],
    [{ detached: true, hasUnpushedCommits: true }, "detached-work"],
    [{ onDefaultBranch: true, hasChanges: true }, "default-branch-work"],
    [{ hasRiskyFiles: true }, "risky-files"],
    [{ hasChanges: true, remote: "" }, "no-remote"],
    [{ hasUnpushedCommits: true, knowsDefaultBranch: false }, "unknown-default-branch"],
  ] as const)("keeps a worktree with %o as %s", (factChanges, reason) => {
    expect(decideWorktreeCleanup({ ...finishedFeature, ...factChanges })).toEqual({ _tag: "keep", reason });
  });

  it("removes a clean detached or default-branch worktree, which holds nothing of its own", () => {
    expect(decideWorktreeCleanup({ ...finishedFeature, detached: true })._tag).toBe("remove");
    expect(decideWorktreeCleanup({ ...finishedFeature, onDefaultBranch: true })._tag).toBe("remove");
    expect(decideWorktreeCleanup({ ...finishedFeature, remote: "" })._tag).toBe("remove");
    expect(decideWorktreeCleanup({ ...finishedFeature, knowsDefaultBranch: false })._tag).toBe("remove");
  });
});
