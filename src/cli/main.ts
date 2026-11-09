#!/usr/bin/env node
/** agent-setup CLI entry point: the only file that starts the Effect runtime. */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CliConfig, Command, ValidationError } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, ParseResult } from "effect";

import { readPackageVersion } from "../install/packageRoot.js";
import { catalogCommand } from "./catalogCommand.js";
import { CliUsageError } from "./cliOptions.js";
import { configCommand } from "./configCommand.js";
import { doctorCommand } from "./doctorCommand.js";
import { installCommand } from "./installCommand.js";
import { menuCommand } from "./menuCommand.js";
import * as TerminalUI from "./TerminalUI.js";
import { uninstallCommand } from "./uninstallCommand.js";
import { updateCommand } from "./updateCommand.js";
import { workflowCommand } from "./workflowCommand.js";

const agentSetup = Command.make("agent-setup").pipe(
  Command.withDescription("Install a personal set of AI coding-agent skills, hooks, and copyable workflows."),
  Command.withSubcommands([
    installCommand,
    updateCommand,
    uninstallCommand,
    menuCommand,
    catalogCommand,
    configCommand,
    doctorCommand,
    workflowCommand,
  ]),
);

const showCliFailure = (error: unknown) => {
  const exitCode =
    ValidationError.isValidationError(error) || ParseResult.isParseError(error) || error instanceof CliUsageError
      ? 2
      : 1;
  const presentation = ValidationError.isValidationError(error) ? Effect.void : TerminalUI.showError(error);
  return presentation.pipe(
    Effect.zipRight(
      Effect.sync(() => {
        process.exitCode = exitCode;
      }),
    ),
  );
};

export const isBareArgv = (argv: ReadonlyArray<string>): boolean => argv.length <= 2;

const program = Effect.gen(function* () {
  const cli = Command.run(agentSetup, { name: "agent-setup", version: yield* readPackageVersion });

  if (isBareArgv(process.argv)) {
    yield* cli(["node", "agent-setup", "--help"]);
    return;
  }

  const invocationArguments = process.argv[2] === "-V" ? ["node", "agent-setup", "--version"] : process.argv;
  yield* cli(invocationArguments);
}).pipe(
  Effect.catchAll(showCliFailure),
  Effect.onInterrupt(() =>
    Effect.sync(() => {
      process.exitCode = 130;
    }),
  ),
  Effect.provide(NodeContext.layer),
  Effect.provide(CliConfig.layer({ showBuiltIns: false })),
);

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

// Tests import this module for isBareArgv, so the runtime starts only when it is the entry point.
if (isDirectRun) {
  NodeRuntime.runMain(program);
}
