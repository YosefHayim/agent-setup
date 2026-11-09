/** The CLI's only presentation layer: every line printed and every prompt asked goes through here. */

import { Prompt } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { Effect } from "effect";

import type { OutputFormat } from "./cli-options.js";

type PlanStep = { readonly label: string; readonly detail: string };

const writeText = (text: string) => Effect.flatMap(Terminal.Terminal, (terminal) => terminal.display(text));

const writeLine = (message: string) => writeText(`${message}\n`);

export const isInteractiveTerminal = Effect.flatMap(Terminal.Terminal, (terminal) => terminal.isTTY);

export const intro = (title: string) => writeLine(`\n  agent-setup · ${title}\n`);

export const outro = (message: string) => writeLine(`\n  ${message}\n`);

export const step = (message: string) => writeLine(`  → ${message}`);

export const success = (message: string) => writeLine(`  ✓ ${message}`);

export const warn = (message: string) => writeLine(`  ! ${message}`);

export const fail = (message: string) => writeLine(`  ✗ ${message}`);

export const detail = (message: string) => writeLine(`  · ${message}`);

export const json = (document: unknown) => writeLine(JSON.stringify(document));

export const note = (message: string, title?: string) =>
  Effect.gen(function* () {
    if (title !== undefined) {
      yield* writeLine(`\n  ${title}`);
      yield* writeLine(`  ${"─".repeat(Math.min(title.length, 40))}`);
    }
    for (const line of message.split("\n")) {
      yield* writeLine(`  ${line}`);
    }
  });

export const showError = (error: unknown) => fail(error instanceof Error ? error.message : String(error));

export const cancelled = outro("Cancelled — nothing was changed.");

export const showCancelled = (request: { readonly format: OutputFormat; readonly scope: string }) =>
  request.format === "json" ? json({ _tag: "cancelled", scope: request.scope }) : cancelled;

// Every prompt answers with its fallback when there is no terminal, so non-TTY runs never block.
export const confirm = (input: { message: string; initialValue: boolean }) =>
  Effect.gen(function* () {
    if (!(yield* isInteractiveTerminal)) {
      return input.initialValue;
    }

    return yield* Prompt.run(Prompt.confirm({ message: input.message, initial: input.initialValue }));
  });

export const selectOne = <Value>(input: {
  message: string;
  choices: ReadonlyArray<{ title: string; value: Value; description?: string }>;
  initial?: Value;
}) =>
  Effect.gen(function* () {
    if (yield* isInteractiveTerminal) {
      return yield* Prompt.run(Prompt.select({ message: input.message, choices: input.choices }));
    }

    const fallback = input.initial === undefined ? input.choices.at(0)?.value : input.initial;
    if (fallback === undefined) {
      return yield* Effect.fail(new Error("No choices available for non-interactive select."));
    }

    return fallback;
  });

export const multiSelect = <Value>(input: {
  message: string;
  choices: ReadonlyArray<{ title: string; value: Value; description?: string; selected?: boolean }>;
  initial: ReadonlyArray<Value>;
}) =>
  Effect.gen(function* () {
    if (!(yield* isInteractiveTerminal)) {
      return [...input.initial];
    }

    const selected = yield* Prompt.run(Prompt.multiSelect({ message: input.message, choices: input.choices }));
    return selected.length > 0 ? selected : [...input.initial];
  });

export const optionalText = (input: { message: string; fallback: string }) =>
  Effect.gen(function* () {
    if (!(yield* isInteractiveTerminal)) {
      return input.fallback;
    }

    const value = (yield* Prompt.run(Prompt.text({ message: input.message, default: input.fallback }))).trim();
    return value === "" ? input.fallback : value;
  });

export const formatPlan = (steps: ReadonlyArray<PlanStep>): ReadonlyArray<string> =>
  steps.map((planStep, index) => `${String(index + 1)}. ${planStep.label}: ${planStep.detail}`);

const showPlan = (input: { readonly title: string; readonly steps: ReadonlyArray<PlanStep> }) =>
  note(formatPlan(input.steps).join("\n"), input.title);

/** Show the numbered plan and ask before applying it; a non-TTY run answers `initialValue` (default no). */
export const confirmPlan = (input: {
  readonly title: string;
  readonly steps: ReadonlyArray<PlanStep>;
  readonly confirmMessage: string;
  readonly initialValue?: boolean;
}) =>
  Effect.gen(function* () {
    yield* showPlan(input);
    return yield* confirm({ message: input.confirmMessage, initialValue: input.initialValue === true });
  });
