/** `agent-setup workflow scaffold` — copy CI and publish workflow templates. */

import { Command, Options } from "@effect/cli";
import { Path } from "@effect/platform";
import { Effect, Option } from "effect";

import { findPackageRoot } from "../install/package-root.js";
import { copyWorkflows } from "../workflows/copy-workflows.js";
import { formatOption, workspaceArgument } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export const workflowTemplateDirectory = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.join(yield* findPackageRoot, "src", "templates", "workflows");
});

export const showCopiedWorkflows = (copiedWorkflows: {
  readonly written: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}) =>
  TerminalUI.note(
    [
      ...copiedWorkflows.written.map((name) => `✓ .github/workflows/${name}`),
      ...copiedWorkflows.skipped.map(
        (name) => `• .github/workflows/${name} exists — kept (use --overwrite to replace)`,
      ),
    ].join("\n"),
    copiedWorkflows.written.length > 0 ? "Scaffolded" : "Nothing written (all present)",
  );

const overwriteOption = Options.boolean("overwrite").pipe(
  Options.withDefault(false),
  Options.withDescription("Overwrite existing workflow files (resync from agent-setup)"),
);

const scaffoldCommand = Command.make(
  "scaffold",
  {
    workspace: workspaceArgument("Target repository root (default: current working directory)"),
    overwrite: overwriteOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const targetRoot = path.resolve(Option.getOrElse(args.workspace, () => process.cwd()));
      if (args.format === "text") {
        yield* TerminalUI.intro("workflow scaffold");
        yield* TerminalUI.step(`workspace: ${targetRoot}`);
      }

      const copiedWorkflows = yield* copyWorkflows({
        targetRoot,
        templateDirectory: yield* workflowTemplateDirectory,
        force: args.overwrite,
      });
      if (args.format === "json") {
        yield* TerminalUI.json({ workspace: targetRoot, ...copiedWorkflows });
        return;
      }

      yield* showCopiedWorkflows(copiedWorkflows);
      yield* TerminalUI.outro(
        "Next: register the npm trusted publisher (repo + publish.yml) — see the publish.yml header.",
      );
    }),
).pipe(Command.withDescription("Copy the single-gate CI + publish workflow set into a repo"));

export const workflowCommand = Command.make("workflow").pipe(
  Command.withDescription("Manage reusable repository workflows"),
  Command.withSubcommands([scaffoldCommand]),
);
