import { describe, expect, it } from "vitest";

import { decideScratchCleanup, type StopCheck } from "./scratch-cleanup-decision.js";

const scratchpad = "/Users/me/.claude/tmp/claude-501/-Users-me-repo/5cc2fa97-8a4b-4379-b0f0-4141d18275da/scratchpad";
const cleanupCommand = 'node "/Users/me/.claude/agent-setup/clear-scratch.js" 5cc2fa97-8a4b-4379-b0f0-4141d18275da';
const finishedTurn: StopCheck = {
  alreadyContinuing: false,
  workPending: false,
  attended: true,
  scratchFoldersWithFiles: [scratchpad],
  cleanupCommand,
};

describe("decideScratchCleanup", () => {
  it("asks an attended session that ends a turn with scratch files, naming the folder and the command", () => {
    const decision = decideScratchCleanup(finishedTurn);

    expect(decision._tag).toBe("ask");
    expect(decision).toMatchObject({ question: expect.stringContaining(`- ${scratchpad}`) });
    expect(decision).toMatchObject({ question: expect.stringContaining(`1. Run: ${cleanupCommand}`) });
    expect(decision).toMatchObject({ question: expect.stringContaining("Never delete work") });
  });

  it.each([
    ["the turn is already continuing after a Stop hook", { alreadyContinuing: true }],
    ["background work or a wakeup is pending", { workPending: true }],
    ["nobody is at the session", { attended: false }],
    ["no scratch folder holds files", { scratchFoldersWithFiles: [] }],
  ])("stays quiet when %s", (_situation, change) => {
    expect(decideScratchCleanup({ ...finishedTurn, ...change })).toEqual({ _tag: "quiet" });
  });
});
