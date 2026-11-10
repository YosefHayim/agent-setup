import { describe, expect, it } from "vitest";

import * as TerminalUI from "./terminal-ui.js";

describe("TerminalUI", () => {
  it("presentation calls complete without throwing", async () => {
    await TerminalUI.intro("test");
    await TerminalUI.step("working");
    await TerminalUI.success("ok");
    await TerminalUI.warn("careful");
    await TerminalUI.detail("note");
    await TerminalUI.fail("problem");
    await TerminalUI.note("line one\nline two", "Details");
    await TerminalUI.outro("done");
    await TerminalUI.showError(new Error("expected failure"));
    expect(typeof TerminalUI.isInteractiveTerminal()).toBe("boolean");
  });

  // vitest runs without a TTY, so each prompt must answer its fallback instead of waiting.
  it("confirm returns its initial value on non-TTY", async () => {
    expect(await TerminalUI.confirm({ message: "Continue?", initialValue: true })).toBe(true);
  });

  it("confirmPlan returns its initial value on non-TTY", async () => {
    const approved = await TerminalUI.confirmPlan({
      title: "Plan",
      steps: [
        { label: "Action", detail: "install" },
        { label: "Scope", detail: "project" },
      ],
      confirmMessage: "Apply?",
      initialValue: false,
    });

    expect(approved).toBe(false);
  });

  it("formats ordered flow steps as a numbered plan", () => {
    expect(
      TerminalUI.formatPlan([
        { label: "Scope", detail: "global" },
        { label: "Features", detail: "scratch-folder-guard" },
      ]),
    ).toEqual(["1. Scope: global", "2. Features: scratch-folder-guard"]);
  });
});
