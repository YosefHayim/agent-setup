import { describe, expect, it } from "vitest";

import { decideMergedWorktreeCleanup, type MergedWorktreeFacts } from "./merged-worktree-decision.js";

const finishedWorktree: MergedWorktreeFacts = {
  isLocked: false,
  isInUse: false,
  isReadable: true,
  hasRecentChange: false,
  hasUncommittedFiles: false,
};

describe("decideMergedWorktreeCleanup", () => {
  it("removes a clean, quiet worktree that nothing uses", () => {
    const facts = finishedWorktree;

    const decision = decideMergedWorktreeCleanup(facts);

    expect(decision).toEqual({ _tag: "remove" });
  });

  it.each([
    [{ isLocked: true, isInUse: true }, "locked"],
    [{ isInUse: true, isReadable: false }, "in-use"],
    [{ isReadable: false, hasRecentChange: true }, "unreadable"],
    [{ hasRecentChange: true, hasUncommittedFiles: true }, "changed-recently"],
    [{ hasUncommittedFiles: true }, "uncommitted-files"],
  ] as const)("keeps a worktree with %o as %s", (factChanges, reason) => {
    const facts = { ...finishedWorktree, ...factChanges };

    const decision = decideMergedWorktreeCleanup(facts);

    expect(decision).toEqual({ _tag: "keep", reason });
  });
});
