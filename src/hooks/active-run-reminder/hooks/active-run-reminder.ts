#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readXdgStateHome } from "../../environment.js";
import { readGitAnswerLines } from "../../git-answers.js";
import { printDecisionAndExit } from "../../hook-output.js";
import { type ActiveRun, createReminderLine } from "../create-reminder-line.js";

const ACTIVE_RUN_FILE_NAME = "active-run.json";
const SUPPORTED_HOOK_EVENT_NAMES = ["SessionStart", "SubagentStart"] as const;

type HookEventName = (typeof SUPPORTED_HOOK_EVENT_NAMES)[number];

type HookEvent = { readonly cwd: string; readonly hookEventName: HookEventName };

const isPlainObject = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const readStringProperty = (fields: Record<string, unknown>, property: string): string | null => {
  const candidate = fields[property];

  const isCandidateString = typeof candidate === "string";
  return isCandidateString ? candidate : null;
};

const isHookEventName = (candidate: unknown): candidate is HookEventName =>
  SUPPORTED_HOOK_EVENT_NAMES.some((eventName) => eventName === candidate);

const decodeHookEvent = (candidate: unknown): HookEvent | null => {
  const isNotPlainObject = !isPlainObject(candidate);
  if (isNotPlainObject) return null;

  const cwd = readStringProperty(candidate, "cwd");
  const hookEventName = candidate.hook_event_name;

  const isCwdMissing = cwd === null;
  if (isCwdMissing) return null;

  const isHookEventUnsupported = !isHookEventName(hookEventName);
  if (isHookEventUnsupported) return null;

  return { cwd, hookEventName };
};

const decodeActiveRun = (candidate: unknown): ActiveRun | null => {
  const isNotPlainObject = !isPlainObject(candidate);
  if (isNotPlainObject) return null;

  const title = readStringProperty(candidate, "title");
  const specPath = readStringProperty(candidate, "specPath");
  const reportPath = readStringProperty(candidate, "reportPath");

  const isAnyFieldMissing = title === null || specPath === null || reportPath === null;
  if (isAnyFieldMissing) return null;

  return { title, specPath, reportPath };
};

const readRunsFolderPath = (): string => {
  const homeFolder = homedir();
  const defaultStorageHome = join(homeFolder, ".local", "state");
  const storageHome = readXdgStateHome() ?? defaultStorageHome;

  return join(storageHome, "agent-setup", "runs");
};

// A worktree maps to its main repository, because the common git folder belongs to the main checkout.
const readRepositoryName = (folder: string): string | null => {
  const gitCommonFolderLines = readGitAnswerLines({
    folder,
    query: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  });

  const isGitAnswerMissing = gitCommonFolderLines == null;
  if (isGitAnswerMissing) return null;

  const [gitCommonFolder] = gitCommonFolderLines;

  const isGitCommonFolderMissing = gitCommonFolder == null;
  if (isGitCommonFolderMissing) return null;

  const mainCheckoutFolder = dirname(gitCommonFolder);

  return basename(mainCheckoutFolder);
};

const readActiveRun = (repositoryName: string): ActiveRun | null => {
  const runsFolder = readRunsFolderPath();
  const activeRunPath = join(runsFolder, repositoryName, ACTIVE_RUN_FILE_NAME);

  const isThereNoActiveRunFile = !existsSync(activeRunPath);
  if (isThereNoActiveRunFile) return null;

  const activeRunFileMessages = readFileSync(activeRunPath, "utf8");
  const activeRunFile = JSON.parse(activeRunFileMessages);

  return decodeActiveRun(activeRunFile);
};

const runRemindActiveRunSpec = (): void => {
  const hookEventFileMessages = readFileSync(0, "utf8");
  const hookEventFile = JSON.parse(hookEventFileMessages);
  const hookEvent = decodeHookEvent(hookEventFile);

  const isNoHookEvent = hookEvent === null;
  if (isNoHookEvent) return;

  const repositoryName = readRepositoryName(hookEvent.cwd);

  const isOutsideRepository = repositoryName === null;
  if (isOutsideRepository) return;

  const activeRun = readActiveRun(repositoryName);

  const isThereNoActiveRun = activeRun === null;
  if (isThereNoActiveRun) return;

  const isSpecFound = existsSync(activeRun.specPath);
  const isSpecMissing = !isSpecFound;
  const reminderLine = createReminderLine({ activeRun, isSpecMissing });

  printDecisionAndExit({
    hookSpecificOutput: { hookEventName: hookEvent.hookEventName, additionalContext: reminderLine },
  });
};

try {
  runRemindActiveRunSpec();
} catch {
  process.exit(0);
}
