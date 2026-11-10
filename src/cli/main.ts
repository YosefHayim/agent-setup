#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Command, CommanderError } from "commander";

import { readPackageVersion } from "../install/package-root.js";
import { createCatalogCommand } from "./catalog-command.js";
import { createCommand, isCliUsageError } from "./cli-options.js";
import { createConfigCommand } from "./config-command.js";
import { createDoctorCommand, type HealthStatus } from "./doctor-command.js";
import { createInstallCommand } from "./install-command.js";
import { createMenuCommand } from "./menu-command.js";
import * as TerminalUI from "./terminal-ui.js";
import { createUninstallCommand } from "./uninstall-command.js";
import { createUpdateCommand } from "./update-command.js";
import { createWorkflowCommand } from "./workflow-command.js";

const FAILED_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const INTERRUPTED_EXIT_CODE = 130;

const applyHealthStatusExitCode = (healthStatus: HealthStatus): void => {
  const isUnhealthy = healthStatus === "unhealthy";
  if (isUnhealthy) {
    process.exitCode = FAILED_EXIT_CODE;
  }
};

const createAgentSetupCommand = (packageVersion: string, abortSignal: AbortSignal): Command =>
  createCommand("agent-setup")
    .description("Install a personal set of AI coding-agent skills, hooks, and copyable workflows.")
    .version(packageVersion, "-V, --version", "Print the agent-setup version")
    .addCommand(createInstallCommand(abortSignal))
    .addCommand(createUpdateCommand(abortSignal))
    .addCommand(createUninstallCommand(abortSignal))
    .addCommand(createMenuCommand(abortSignal))
    .addCommand(createCatalogCommand())
    .addCommand(createConfigCommand(abortSignal))
    .addCommand(createDoctorCommand(applyHealthStatusExitCode))
    .addCommand(createWorkflowCommand());

export const isBareArgv = (argv: ReadonlyArray<string>): boolean => argv.length <= 2;

const reportFailure = async (request: { readonly error: unknown; readonly isInterrupted: boolean }): Promise<void> => {
  const { error, isInterrupted } = request;
  const isCommanderExit = error instanceof CommanderError;
  if (isCommanderExit) {
    // Help and version exit 0; a usage error from commander has already printed its message.
    process.exitCode = error.exitCode === 0 ? 0 : USAGE_EXIT_CODE;
    return;
  }

  if (isInterrupted) {
    return;
  }

  await TerminalUI.showError(error);
  process.exitCode = isCliUsageError(error) ? USAGE_EXIT_CODE : FAILED_EXIT_CODE;
};

const main = async (argv: ReadonlyArray<string>): Promise<void> => {
  const abortController = new AbortController();
  process.once("SIGINT", () => {
    process.exitCode = INTERRUPTED_EXIT_CODE;
    abortController.abort();
  });

  try {
    const packageVersion = await readPackageVersion();
    const agentSetup = createAgentSetupCommand(packageVersion, abortController.signal);
    const isBare = isBareArgv(argv);
    const parsedArgv = isBare ? ["node", "agent-setup", "--help"] : argv;
    await agentSetup.parseAsync(parsedArgv);
  } catch (error) {
    await reportFailure({ error, isInterrupted: abortController.signal.aborted });
  }
};

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
// tsx runs main.ts while the build runs main.js, so both spellings count as this file.
let isDirectRun = invoked === thisFile || invoked === thisFile.replace(/\.ts$/, ".js");
if (!isDirectRun && invoked !== undefined) {
  try {
    // The npm bin is a symlink into node_modules; realpath makes argv match import.meta.url.
    isDirectRun = realpathSync(invoked) === thisFile;
  } catch {
    // An unreadable argv path is simply not this file.
  }
}

// Tests import this module for isBareArgv, so the CLI runs only when this file is the entry point.
if (isDirectRun) {
  await main(process.argv);
}
