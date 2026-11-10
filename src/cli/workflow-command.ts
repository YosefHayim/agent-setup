import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Argument, type Command, Option } from "commander";

import { isNotFound } from "../install/file-bytes.js";
import { findPackageRoot } from "../install/package-root.js";
import { copyWorkflows } from "../workflows/copy-workflows.js";
import { createCliUsageError, createCommand, type FormatOptions, formatOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

interface ScaffoldOptions extends FormatOptions {
  readonly overwrite: boolean;
}

const overwriteOption = new Option(
  "--overwrite",
  "Overwrite existing workflow files (resync from agent-setup)",
).default(false);

export const findWorkflowTemplateDirectory = async (): Promise<string> => {
  const packageRoot = await findPackageRoot();
  return join(packageRoot, "src", "templates", "workflows");
};

export const showCopiedWorkflows = async (copiedWorkflows: {
  readonly written: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}): Promise<void> => {
  const lines = [
    ...copiedWorkflows.written.map((name) => `✓ .github/workflows/${name}`),
    ...copiedWorkflows.skipped.map((name) => `• .github/workflows/${name} exists — kept (use --overwrite to replace)`),
  ];
  const isAnyWorkflowWritten = copiedWorkflows.written.length > 0;
  await TerminalUI.note(lines.join("\n"), isAnyWorkflowWritten ? "Scaffolded" : "Nothing written (all present)");
};

const findWorkspaceStats = async (workspacePath: string): Promise<Stats | null> => {
  try {
    return await stat(workspacePath);
  } catch (error) {
    const isMissingWorkspace = isNotFound(error);
    if (isMissingWorkspace) {
      return null;
    }

    throw error;
  }
};

// A workspace that is missing or not a directory is bad usage (exit 2), as the old argument check was.
const readWorkspaceRoot = async (workspace: string | undefined): Promise<string> => {
  const requestedWorkspace = workspace ?? process.cwd();
  const targetRoot = resolve(requestedWorkspace);
  const workspaceStats = await findWorkspaceStats(targetRoot);

  const isWorkspaceDirectory = workspaceStats?.isDirectory();
  if (isWorkspaceDirectory) {
    return targetRoot;
  }

  throw createCliUsageError(`Workspace must be an existing directory: ${requestedWorkspace}`);
};

const createScaffoldCommand = (): Command =>
  createCommand("scaffold")
    .description("Copy the single-gate CI + publish workflow set into a repo")
    .addArgument(new Argument("[workspace]", "Target repository root (default: current working directory)"))
    .addOption(overwriteOption)
    .addOption(formatOption)
    .action(async (workspace: string | undefined, options: ScaffoldOptions) => {
      const targetRoot = await readWorkspaceRoot(workspace);
      const isJsonFormat = options.format === "json";
      const isTextFormat = options.format === "text";

      if (isTextFormat) {
        await TerminalUI.intro("workflow scaffold");
        await TerminalUI.step(`workspace: ${targetRoot}`);
      }

      const templateDirectory = await findWorkflowTemplateDirectory();
      const copiedWorkflows = await copyWorkflows({ targetRoot, templateDirectory, force: options.overwrite });
      if (isJsonFormat) {
        await TerminalUI.showDocument({ workspace: targetRoot, ...copiedWorkflows });
        return;
      }

      await showCopiedWorkflows(copiedWorkflows);
      await TerminalUI.outro(
        "Next: register the npm trusted publisher (repo + publish.yml) — see the publish.yml header.",
      );
    });

export const createWorkflowCommand = (): Command =>
  createCommand("workflow").description("Manage reusable repository workflows").addCommand(createScaffoldCommand());
