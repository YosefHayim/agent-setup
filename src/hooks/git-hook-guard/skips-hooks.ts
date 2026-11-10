import type { Assignment, CommandFacts, GitCall } from "./git-commands.js";

const HOOKS_PATH_KEY = "core.hookspath";
const ALLOWED_HOOKS_PATHS = new Set([".husky/_", ".githooks"]);
const HOOK_RUNNING_SUBCOMMANDS = new Set(["commit", "push"]);
const NO_VERIFY = "--no-verify";
// git accepts any unambiguous start of a long option, and "--no-veri" is the shortest start that is not "--no-verbose".
const SHORTEST_NO_VERIFY_LENGTH = "--no-veri".length;
const LONG_OPTION_END = "--";
// git commit short flags that take a value, in the same word or the next, e.g. -m "msg" or -mmsg.
const COMMIT_FIELD_LETTERS = new Set(["F", "m", "C", "c", "t"]);
// git commit short flags whose optional value is written right after them, e.g. -uno or -SKEYID.
const COMMIT_ATTACHED_FIELD_LETTERS = new Set(["u", "S"]);
const COMMIT_FIELD_SETTINGS = new Set([
  "--message",
  "--file",
  "--author",
  "--date",
  "--reuse-message",
  "--reedit-message",
  "--fixup",
  "--squash",
  "--template",
  "--cleanup",
  "--trailer",
  "--pathspec-from-file",
]);
const SETTINGS_FIELD_SETTINGS = new Set(["-f", "--file", "--blob", "--type", "--default"]);
const SETTINGS_READ_SETTINGS = new Set(["--get", "--get-all", "--get-regexp", "--get-urlmatch", "-l", "--list"]);
const SETTINGS_UNSET_SETTINGS = new Set(["--unset", "--unset-all"]);
const SETTINGS_VERBS = new Set(["get", "set", "unset"]);
const GIT_SETTINGS_KEY_VARIABLE = /^GIT_CONFIG_KEY_\d+$/u;
const SHORT_SETTINGS = /^-[^-]/u;

const SKIPPED_HOOKS_REASON =
  "git-hook-guard: This repo's git hooks run lint and typecheck before every push. Fix what they report instead of skipping them.";
const MOVED_HOOKS_REASON =
  "git-hook-guard: Do not point git at another hooks folder or turn the hooks off. The repo's git hooks run lint and typecheck before every push. Fix what they report instead.";

const isNoVerify = (option: string): boolean =>
  option.length >= SHORTEST_NO_VERIFY_LENGTH && NO_VERIFY.startsWith(option);

const hasNoVerify = (argumentList: ReadonlyArray<string>): boolean => {
  const settingsEnd = [...argumentList, LONG_OPTION_END].indexOf(LONG_OPTION_END);
  const settings = argumentList.slice(0, settingsEnd);
  return settings.some(isNoVerify);
};

// A cluster such as -an holds flags until a flag takes the rest of the cluster, or the next word, as its value.
const readCommitCluster = (letters: string): { readonly skipsHooks: boolean; readonly takesNextWord: boolean } => {
  const letter = letters.slice(0, 1);
  const rest = letters.slice(1);

  const isEmptyLetter = letter === "";
  if (isEmptyLetter) {
    return { skipsHooks: false, takesNextWord: false };
  }

  const isLetterN = letter === "n";
  if (isLetterN) {
    return { skipsHooks: true, takesNextWord: false };
  }

  const isAttachedFieldLetter = COMMIT_ATTACHED_FIELD_LETTERS.has(letter);
  if (isAttachedFieldLetter) {
    return { skipsHooks: false, takesNextWord: false };
  }

  const isFieldLetter = COMMIT_FIELD_LETTERS.has(letter);
  if (isFieldLetter) {
    return { skipsHooks: false, takesNextWord: rest === "" };
  }

  return readCommitCluster(rest);
};

const commitSkipsHooks = (argumentList: ReadonlyArray<string>): boolean => {
  const [arg = "", ...rest] = argumentList;
  const [, ...afterField] = rest;

  const isOptionListEnd = argumentList.length === 0 || arg === LONG_OPTION_END;
  if (isOptionListEnd) {
    return false;
  }

  if (isNoVerify(arg)) {
    return true;
  }

  const isCommitFieldSetting = COMMIT_FIELD_SETTINGS.has(arg);
  if (isCommitFieldSetting) {
    return commitSkipsHooks(afterField);
  }

  const isNotShortSetting = !SHORT_SETTINGS.test(arg);
  if (isNotShortSetting) {
    return commitSkipsHooks(rest);
  }

  const cluster = readCommitCluster(arg.slice(1));

  const isHooksSkippingCluster = cluster.skipsHooks;
  if (isHooksSkippingCluster) {
    return true;
  }

  const isNextWordTakingCluster = cluster.takesNextWord;
  if (isNextWordTakingCluster) {
    return commitSkipsHooks(afterField);
  }

  return commitSkipsHooks(rest);
};

const listPositionalWords = (argumentList: ReadonlyArray<string>): ReadonlyArray<string> => {
  const [arg = "", ...rest] = argumentList;
  const [, ...afterField] = rest;

  const hasNoArguments = argumentList.length === 0;
  if (hasNoArguments) {
    return [];
  }

  const isSettingsFieldSetting = SETTINGS_FIELD_SETTINGS.has(arg);
  if (isSettingsFieldSetting) {
    return listPositionalWords(afterField);
  }

  const isOptionArgument = arg.startsWith("-");
  if (isOptionArgument) {
    return listPositionalWords(rest);
  }

  return [arg, ...listPositionalWords(rest)];
};

const readNormalizedHooksPath = (hooksPath: string): string => hooksPath.replace(/^\.\//u, "").replace(/\/$/u, "");

const isSettingsChangesHooksPath = (argumentList: ReadonlyArray<string>): boolean => {
  const words = listPositionalWords(argumentList);
  const [verb = ""] = words;
  const hasVerb = SETTINGS_VERBS.has(verb);

  const [key = "", field] = words.slice(Number(hasVerb));

  const isNotHooksPathKey = key.toLowerCase() !== HOOKS_PATH_KEY;
  if (isNotHooksPathKey) {
    return false;
  }

  const isUnset = verb === "unset" || argumentList.some((arg) => SETTINGS_UNSET_SETTINGS.has(arg));
  if (isUnset) {
    return true;
  }

  const isRead = verb === "get" || argumentList.some((arg) => SETTINGS_READ_SETTINGS.has(arg));

  const isReadOrMissingField = isRead || field == null;
  if (isReadOrMissingField) {
    return false;
  }

  return !ALLOWED_HOOKS_PATHS.has(readNormalizedHooksPath(field));
};

const isMovesHooksPathVariable = (assignment: Assignment): boolean => {
  const lowerField = assignment.value.toLowerCase();

  const isAssignmentNameGITCONFIGPARAMETERS = assignment.name === "GIT_CONFIG_PARAMETERS";
  if (isAssignmentNameGITCONFIGPARAMETERS) {
    return lowerField.includes(HOOKS_PATH_KEY);
  }

  return GIT_SETTINGS_KEY_VARIABLE.test(assignment.name) && lowerField === HOOKS_PATH_KEY;
};

const callSkipsHooks = (gitCall: GitCall): boolean => {
  const isHookRunning = HOOK_RUNNING_SUBCOMMANDS.has(gitCall.subcommand);

  const isHookRunningWithNoVerify = isHookRunning && hasNoVerify(gitCall.args);
  if (isHookRunningWithNoVerify) {
    return true;
  }

  return gitCall.subcommand === "commit" && commitSkipsHooks(gitCall.args);
};

const callMovesHooks = (gitCall: GitCall): boolean => {
  const setsInlineHooksPath = gitCall.configKeys.includes(HOOKS_PATH_KEY);
  const changesSettings = gitCall.subcommand === "config" && isSettingsChangesHooksPath(gitCall.args);
  return setsInlineHooksPath || changesSettings;
};

export const skipReasonOf = (facts: CommandFacts): string | undefined => {
  const turnsHuskyOff = facts.assignments.some((assignment) => assignment.name === "HUSKY" && assignment.value === "0");

  const isHuskyOffOrHooksSkipped = turnsHuskyOff || facts.gitCalls.some(callSkipsHooks);
  if (isHuskyOffOrHooksSkipped) {
    return SKIPPED_HOOKS_REASON;
  }

  const isHooksPathMoved = facts.assignments.some(isMovesHooksPathVariable) || facts.gitCalls.some(callMovesHooks);
  if (isHooksPathMoved) {
    return MOVED_HOOKS_REASON;
  }

  return undefined;
};
