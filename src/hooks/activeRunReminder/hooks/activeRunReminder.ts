#!/usr/bin/env node
// SessionStart and SubagentStart hook that tells the agent to re-read its repo's active run spec; fails open.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { gitAnswerLines } from "../../lib/gitAnswers.js";
import { printDecisionAndExit } from "../../lib/hookOutput.js";
import { type ActiveRun, createReminderLine } from "../lib/createReminderLine.js";

const ACTIVE_RUN_FILE_NAME = "active-run.json";
const SUPPORTED_HOOK_EVENT_NAMES = ["SessionStart", "SubagentStart"] as const;

type HookEventName = (typeof SUPPORTED_HOOK_EVENT_NAMES)[number];

type HookEvent = { readonly cwd: string; readonly hookEventName: HookEventName };

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const stringProperty = (record: Record<string, unknown>, property: string): string | null => {
  const candidate = record[property];
  return typeof candidate === "string" ? candidate : null;
};

const isHookEventName = (candidate: unknown): candidate is HookEventName =>
  SUPPORTED_HOOK_EVENT_NAMES.some((eventName) => eventName === candidate);

const decodeHookEvent = (candidate: unknown): HookEvent | null => {
  if (!isRecord(candidate)) return null;

  const cwd = stringProperty(candidate, "cwd");
  const hookEventName = candidate.hook_event_name;
  if (cwd === null) return null;

  if (!isHookEventName(hookEventName)) return null;

  return { cwd, hookEventName };
};

const decodeActiveRun = (candidate: unknown): ActiveRun | null => {
  if (!isRecord(candidate)) return null;

  const title = stringProperty(candidate, "title");
  const specPath = stringProperty(candidate, "specPath");
  const reportPath = stringProperty(candidate, "reportPath");
  if (title === null || specPath === null || reportPath === null) return null;

  return { title, specPath, reportPath };
};

const runsFolderPath = (): string => {
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateHome, "agent-setup", "runs");
};

// A worktree maps to its main repository, because the common git folder belongs to the main checkout.
const readRepositoryName = (folder: string): string | null => {
  const gitCommonFolderLines = gitAnswerLines({
    folder,
    query: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  });
  if (gitCommonFolderLines === undefined) return null;

  // The first line is the common folder when git succeeded and printed one.
  const [gitCommonFolder] = gitCommonFolderLines;
  if (gitCommonFolder === undefined) return null;

  return basename(dirname(gitCommonFolder));
};

const readActiveRun = (repositoryName: string): ActiveRun | null => {
  const activeRunPath = join(runsFolderPath(), repositoryName, ACTIVE_RUN_FILE_NAME);
  const isThereNoActiveRunFile = !existsSync(activeRunPath);
  if (isThereNoActiveRunFile) return null;

  const activeRunFile = JSON.parse(readFileSync(activeRunPath, "utf8"));

  return decodeActiveRun(activeRunFile);
};

const remindActiveRunSpec = (): void => {
  const hookEvent = decodeHookEvent(JSON.parse(readFileSync(0, "utf8")));
  if (hookEvent === null) return;

  const repositoryName = readRepositoryName(hookEvent.cwd);
  if (repositoryName === null) return;

  const activeRun = readActiveRun(repositoryName);
  if (activeRun === null) return;

  const isSpecFound = existsSync(activeRun.specPath);
  const reminderLine = createReminderLine({ activeRun, isSpecFound });

  printDecisionAndExit({
    hookSpecificOutput: { hookEventName: hookEvent.hookEventName, additionalContext: reminderLine },
  });
};

try {
  remindActiveRunSpec();
} catch {
  process.exit(0);
}
