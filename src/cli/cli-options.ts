import { Argument, Command, Option } from "commander";

import type { Scope } from "#src/install/receipt.js";
import { scopeSchema } from "#src/install/receipt.js";
import * as TerminalUI from "./terminal-ui.js";

export type PrintFormat = "text" | "json";

export interface FormatSettings {
  readonly format: PrintFormat;
}

export interface ScopeSettings extends FormatSettings {
  readonly scope: Scope;
}

export interface ScopeYesSettings extends ScopeSettings {
  readonly yes: boolean;
}

// Every command gets exitOverride, because commander does not pass it on to subcommands.
export const createCommand = (name: string): Command => new Command(name).exitOverride();

export const scopeOption = new Option("--scope <scope>", "Target the global home installation root (default)")
  .choices(scopeSchema.options)
  .default("global");

export const yesOption = new Option("-y, --yes", "Skip confirmation prompts (CI / scripted)").default(false);

export const formatOption = new Option("--format <format>", "Render human-readable text or one JSON document")
  .choices(["text", "json"])
  .default("text");

export const readFeatureIdsArgument = (description: string): Argument => new Argument("[feature-id...]", description);

// Bad usage exits with code 2. main finds it by name, so no Error subclass is needed.
export const createCliUsageError = (issue: string): Error => Object.assign(new Error(issue), { name: "CliUsageError" });

export const isCliUsageError = (error: unknown): boolean => error instanceof Error && error.name === "CliUsageError";

// Asks before a destructive change; a run with no terminal to ask on must pass --yes.
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
