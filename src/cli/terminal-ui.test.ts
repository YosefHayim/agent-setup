import { NodeContext } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { Effect } from "effect";

import * as TerminalUI from "./terminal-ui.js";

describe("TerminalUI", () => {
  layer(NodeContext.layer)((it) => {
    it.effect("presentation effects complete without throwing", () =>
      Effect.gen(function* () {
        yield* TerminalUI.intro("test");
        yield* TerminalUI.step("working");
        yield* TerminalUI.success("ok");
        yield* TerminalUI.warn("careful");
        yield* TerminalUI.detail("note");
        yield* TerminalUI.fail("problem");
        yield* TerminalUI.note("line one\nline two", "Details");
        yield* TerminalUI.outro("done");
        yield* TerminalUI.showError(new Error("expected failure"));
        expect(typeof (yield* TerminalUI.isInteractiveTerminal)).toBe("boolean");
      }),
    );

    // vitest runs without a TTY, so each prompt must answer its fallback instead of waiting.
    it.effect("confirm returns its initial value on non-TTY", () =>
      Effect.gen(function* () {
        expect(yield* TerminalUI.confirm({ message: "Continue?", initialValue: true })).toBe(true);
      }),
    );

    it.effect("confirmPlan returns its initial value on non-TTY", () =>
      Effect.gen(function* () {
        const approved = yield* TerminalUI.confirmPlan({
          title: "Plan",
          steps: [
            { label: "Action", detail: "install" },
            { label: "Scope", detail: "project" },
          ],
          confirmMessage: "Apply?",
          initialValue: false,
        });
        expect(approved).toBe(false);
      }),
    );
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
