import { describe, expect, it } from "vitest";

import { type BranchFacts, decideBranchPush } from "./branchPushDecision.js";

const finishedFeature: BranchFacts = {
  inUse: false,
  readable: true,
  isDefaultBranch: false,
  knowsDefaultBranch: true,
  hasRiskyFiles: false,
  remote: "origin",
};

describe("decideBranchPush", () => {
  it("pushes a feature branch with only safe files", () => {
    expect(decideBranchPush(finishedFeature)).toEqual({ _tag: "push" });
  });

  it.each([
    [{ inUse: true, isDefaultBranch: true }, "in-use"],
    [{ isDefaultBranch: true, remote: "" }, "default-branch-work"],
    [{ remote: "", knowsDefaultBranch: false }, "no-remote"],
    [{ knowsDefaultBranch: false, readable: false }, "unknown-default-branch"],
    [{ readable: false, hasRiskyFiles: true }, "unreadable"],
    [{ hasRiskyFiles: true }, "risky-files"],
  ] as const)("keeps a branch with %o as %s", (factChanges, reason) => {
    expect(decideBranchPush({ ...finishedFeature, ...factChanges })).toEqual({ _tag: "keep", reason });
  });
});
