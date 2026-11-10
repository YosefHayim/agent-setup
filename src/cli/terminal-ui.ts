import type { Option } from "@clack/prompts";
import * as ClackPrompts from "@clack/prompts";

import type { OutputFormat } from "./cli-options.js";

interface PlanStep {
  readonly label: string;
  readonly detail: string;
}

// A cancelled prompt (Ctrl-C) becomes a plain error, so main prints it and exits 1.
const readPromptAnswer = <Answer>(answer: Answer | typeof ClackPrompts.CANCEL_SYMBOL): Answer => {
  const isCancelled = ClackPrompts.isCancel(answer);
  if (isCancelled) {
    throw new Error("Prompt cancelled.");
  }

  return answer;
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

  const confirmAnswer = await ClackPrompts.confirm({ message, initialValue });
  return readPromptAnswer(confirmAnswer);
};

export const selectOne = async <Value>({
  message,
  choices,
  initial,
}: {
  message: string;
  choices: ReadonlyArray<Option<Value>>;
  initial?: Value;
}): Promise<Value> => {
  const isInteractive = isInteractiveTerminal();
  if (isInteractive) {
    const selectAnswer = await ClackPrompts.select({ message, options: [...choices], initialValue: initial });
    return readPromptAnswer(selectAnswer);
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
  choices: ReadonlyArray<Option<Value>>;
  initial: ReadonlyArray<Value>;
}): Promise<Value[]> => {
  const isNonInteractive = !isInteractiveTerminal();
  if (isNonInteractive) {
    return [...initial];
  }

  const multiSelectAnswer = await ClackPrompts.multiselect({
    message,
    options: [...choices],
    initialValues: [...initial],
    required: false,
  });
  const selected = readPromptAnswer(multiSelectAnswer);
  const isThereSelection = selected.length > 0;
  return isThereSelection ? selected : [...initial];
};

export const optionalText = async ({ message, fallback }: { message: string; fallback: string }): Promise<string> => {
  const isNonInteractive = !isInteractiveTerminal();
  if (isNonInteractive) {
    return fallback;
  }

  const textAnswer = await ClackPrompts.text({ message, initialValue: fallback });
  const trimmedAnswer = readPromptAnswer(textAnswer).trim();
  const isThereNoAnswer = trimmedAnswer === "";
  return isThereNoAnswer ? fallback : trimmedAnswer;
};

export const formatPlan = (steps: ReadonlyArray<PlanStep>): ReadonlyArray<string> =>
  steps.map((planStep, index) => `${String(index + 1)}. ${planStep.label}: ${planStep.detail}`);

const showPlan = async ({ title, steps }: { readonly title: string; readonly steps: ReadonlyArray<PlanStep> }) => {
  const planLines = formatPlan(steps);
  await note(planLines.join("\n"), title);
};

// Shows the numbered plan and asks before applying it; a non-TTY run answers `initialValue` (default no).
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
