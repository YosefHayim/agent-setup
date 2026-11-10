/** The CLI's only presentation layer: every line printed and every prompt asked goes through here. */

import { Prompt } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";

import type { OutputFormat } from "./cli-options.js";

interface PlanStep {
  readonly label: string;
  readonly detail: string;
}

// Prompts are @effect/cli widgets until the CLI moves off Effect. A failed prompt (Ctrl-C) rethrows its own error, so main still sees it.
const runPrompt = async <Answer>(prompt: Prompt.Prompt<Answer>): Promise<Answer> => {
  const promptExit = await Effect.runPromiseExit(Prompt.run(prompt).pipe(Effect.provide(NodeContext.layer)));
  const didPromptAnswer = Exit.isSuccess(promptExit);
  if (didPromptAnswer) {
    return promptExit.value;
  }

  throw Cause.squash(promptExit.cause);
};

const writeLine = async (message: string): Promise<void> => {
  process.stdout.write(`${message}\n`);
};

export const isInteractiveTerminal = (): boolean => Boolean(process.stdout.isTTY);

export const intro = (title: string) => writeLine(`\n  agent-setup · ${title}\n`);

export const outro = (message: string) => writeLine(`\n  ${message}\n`);

export const step = (message: string) => writeLine(`  → ${message}`);

export const success = (message: string) => writeLine(`  ✓ ${message}`);

export const warn = (message: string) => writeLine(`  ! ${message}`);

export const fail = (message: string) => writeLine(`  ✗ ${message}`);

export const detail = (message: string) => writeLine(`  · ${message}`);

export const showDocument = (printedDocument: unknown) => writeLine(JSON.stringify(printedDocument));

export const note = async (message: string, title?: string): Promise<void> => {
  const hasTitle = title != null;
  if (hasTitle) {
    const maximumTitleRuleLength = 40;
    await writeLine(`\n  ${title}`);
    await writeLine(`  ${"─".repeat(Math.min(title.length, maximumTitleRuleLength))}`);
  }

  for (const line of message.split("\n")) {
    await writeLine(`  ${line}`);
  }
};

export const showError = async (error: unknown): Promise<void> => {
  const isErrorObject = error instanceof Error;
  const message = isErrorObject ? error.message : String(error);
  await fail(message);
};

export const showCancelledOutro = () => outro("Cancelled — nothing was changed.");

export const showCancelled = async (request: {
  readonly format: OutputFormat;
  readonly scope: string;
}): Promise<void> => {
  const isJsonFormat = request.format === "json";
  if (isJsonFormat) {
    await showDocument({ _tag: "cancelled", scope: request.scope });
    return;
  }

  await showCancelledOutro();
};

// Every prompt answers with its fallback when there is no terminal, so non-TTY runs never block.
export const confirm = async ({
  message,
  initialValue,
}: {
  message: string;
  initialValue: boolean;
}): Promise<boolean> => {
  const isNonInteractive = !isInteractiveTerminal();
  if (isNonInteractive) {
    return initialValue;
  }

  return runPrompt(Prompt.confirm({ message, initial: initialValue }));
};

export const selectOne = async <Value>({
  message,
  choices,
  initial,
}: {
  message: string;
  choices: ReadonlyArray<{ title: string; value: Value; description?: string }>;
  initial?: Value;
}): Promise<Value> => {
  const isInteractive = isInteractiveTerminal();
  if (isInteractive) {
    return runPrompt(Prompt.select({ message, choices }));
  }

  const hasInitial = initial != null;
  const fallback = hasInitial ? initial : choices.at(0)?.value;
  const isThereNoFallback = fallback === undefined;
  if (isThereNoFallback) {
    throw new Error("No choices available for non-interactive select.");
  }

  return fallback;
};

export const multiSelect = async <Value>({
  message,
  choices,
  initial,
}: {
  message: string;
  choices: ReadonlyArray<{ title: string; value: Value; description?: string; selected?: boolean }>;
  initial: ReadonlyArray<Value>;
}): Promise<Value[]> => {
  const isNonInteractive = !isInteractiveTerminal();
  if (isNonInteractive) {
    return [...initial];
  }

  const selected = await runPrompt(Prompt.multiSelect({ message, choices }));
  const isThereSelection = selected.length > 0;
  return isThereSelection ? selected : [...initial];
};

export const optionalText = async ({ message, fallback }: { message: string; fallback: string }): Promise<string> => {
  const isNonInteractive = !isInteractiveTerminal();
  if (isNonInteractive) {
    return fallback;
  }

  const typedAnswer = await runPrompt(Prompt.text({ message, default: fallback }));
  const trimmedAnswer = typedAnswer.trim();
  const isThereNoAnswer = trimmedAnswer === "";
  return isThereNoAnswer ? fallback : trimmedAnswer;
};

export const formatPlan = (steps: ReadonlyArray<PlanStep>): ReadonlyArray<string> =>
  steps.map((planStep, index) => `${String(index + 1)}. ${planStep.label}: ${planStep.detail}`);

const showPlan = async ({ title, steps }: { readonly title: string; readonly steps: ReadonlyArray<PlanStep> }) => {
  const planLines = formatPlan(steps);
  await note(planLines.join("\n"), title);
};

/** Show the numbered plan and ask before applying it; a non-TTY run answers `initialValue` (default no). */
export const confirmPlan = async ({
  title,
  steps,
  confirmMessage,
  initialValue,
}: {
  readonly title: string;
  readonly steps: ReadonlyArray<PlanStep>;
  readonly confirmMessage: string;
  readonly initialValue?: boolean;
}): Promise<boolean> => {
  await showPlan({ title, steps });
  const isInitialValueYes = initialValue === true;
  return confirm({ message: confirmMessage, initialValue: isInitialValueYes });
};
