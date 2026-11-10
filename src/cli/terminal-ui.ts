import type { Option } from "@clack/prompts";
import * as ClackPrompts from "@clack/prompts";

import type { PrintFormat } from "./cli-options.js";

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

export const runIntro = (title: string) => writeLine(`\n  agent-setup · ${title}\n`);

export const runOutro = (message: string) => writeLine(`\n  ${message}\n`);

export const runStep = (message: string) => writeLine(`  → ${message}`);

export const runSuccess = (message: string) => writeLine(`  ✓ ${message}`);

export const warn = (message: string) => writeLine(`  ! ${message}`);

export const fail = (message: string) => writeLine(`  ✗ ${message}`);

export const runDetail = (message: string) => writeLine(`  · ${message}`);

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

export const showCancelledOutro = () => runOutro("Cancelled — nothing was changed.");

export const showCancelled = async (request: {
  readonly format: PrintFormat;
  readonly scope: string;
}): Promise<void> => {
  const isDocumentFormat = request.format === "json";
  if (isDocumentFormat) {
    await showDocument({ _tag: "cancelled", scope: request.scope });
    return;
  }

  await showCancelledOutro();
};

// Every prompt answers with its fallback when there is no terminal, so non-TTY runs never block.
export const confirm = async ({
  message,
  initialValue: initialField,
}: {
  message: string;
  initialValue: boolean;
}): Promise<boolean> => {
  const isNonInteractive = !isInteractiveTerminal();
  if (isNonInteractive) {
    return initialField;
  }

  const confirmAnswer = await ClackPrompts.confirm({ message, initialValue: initialField });
  return readPromptAnswer(confirmAnswer);
};

export const selectOne = async <Field>({
  message,
  choices,
  initial,
}: {
  message: string;
  choices: ReadonlyArray<Option<Field>>;
  initial?: Field;
}): Promise<Field> => {
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

export const listMultiSelect = async <Value>({
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

export const readOptionalString = async ({
  message,
  fallback,
}: {
  message: string;
  fallback: string;
}): Promise<string> => {
  const isNonInteractive = !isInteractiveTerminal();
  if (isNonInteractive) {
    return fallback;
  }

  const stringAnswer = await ClackPrompts.text({ message, initialValue: fallback });
  const trimmedAnswer = readPromptAnswer(stringAnswer).trim();
  const isThereNoAnswer = trimmedAnswer === "";
  return isThereNoAnswer ? fallback : trimmedAnswer;
};

export const createPlanLines = (steps: ReadonlyArray<PlanStep>): ReadonlyArray<string> =>
  steps.map((planStep, index) => `${String(index + 1)}. ${planStep.label}: ${planStep.detail}`);

const showPlan = async ({ title, steps }: { readonly title: string; readonly steps: ReadonlyArray<PlanStep> }) => {
  const planLines = createPlanLines(steps);
  await note(planLines.join("\n"), title);
};

// Shows the numbered plan and asks before applying it; a non-TTY run answers `initialValue` (default no).
export const confirmPlan = async ({
  title,
  steps,
  confirmMessage,
  initialValue: initialField,
}: {
  readonly title: string;
  readonly steps: ReadonlyArray<PlanStep>;
  readonly confirmMessage: string;
  readonly initialValue?: boolean;
}): Promise<boolean> => {
  await showPlan({ title, steps });
  const isInitialFieldYes = initialField === true;
  return confirm({ message: confirmMessage, initialValue: isInitialFieldYes });
};
