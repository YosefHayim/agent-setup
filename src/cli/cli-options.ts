/** Shared public options and arguments whose spelling and defaults are part of the CLI contract. */

import { Args, Options } from "@effect/cli";

import { scopeSchema } from "../install/receipt.js";
import * as TerminalUI from "./terminal-ui.js";

export const scopeOption = Options.choice("scope", scopeSchema.options).pipe(
  Options.withDefault("global"),
  Options.withDescription("Target the global home installation root (default)"),
);

export const featureIdsArgument = (description: string) =>
  Args.text({ name: "feature-id" }).pipe(Args.repeated, Args.withDescription(description));

export const workspaceArgument = (description: string) =>
  Args.directory({ name: "workspace", exists: "either" }).pipe(Args.optional, Args.withDescription(description));

export const yesOption = Options.boolean("yes").pipe(
  Options.withAlias("y"),
  Options.withDefault(false),
  Options.withDescription("Skip confirmation prompts (CI / scripted)"),
);

const outputFormats = ["text", "json"] as const;
export type OutputFormat = (typeof outputFormats)[number];

export const formatOption = Options.choice("format", outputFormats).pipe(
  Options.withDefault("text"),
  Options.withDescription("Render human-readable text or one JSON document"),
);

// Bad usage exits with code 2. main finds it by name, so no Error subclass is needed.
export const createCliUsageError = (issue: string): Error => Object.assign(new Error(issue), { name: "CliUsageError" });

export const isCliUsageError = (error: unknown): boolean => error instanceof Error && error.name === "CliUsageError";

/** Ask before a destructive change unless `--yes` was passed; without a terminal to ask on, `--yes` is required. */
export const confirmDestructive = async (request: {
  readonly yes: boolean;
  readonly question: string;
  readonly missingYesIssue: string;
}): Promise<boolean> => {
  const isYesGiven = request.yes;
  if (isYesGiven) {
    return true;
  }

  const isNonInteractive = !TerminalUI.isInteractiveTerminal();
  if (isNonInteractive) {
    throw createCliUsageError(request.missingYesIssue);
  }

  return TerminalUI.confirm({ message: request.question, initialValue: false });
};
