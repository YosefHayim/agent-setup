import type { Assignment, CommandFacts, GitCall } from "./gitCommands.js";

const HOOKS_PATH_KEY = "core.hookspath";
const ALLOWED_HOOKS_PATHS = new Set([".husky/_", ".githooks"]);
const HOOK_RUNNING_SUBCOMMANDS = new Set(["commit", "push"]);
const NO_VERIFY = "--no-verify";
// git accepts any unambiguous start of a long option, and "--no-veri" is the shortest start that is not "--no-verbose".
const SHORTEST_NO_VERIFY_LENGTH = "--no-veri".length;
const LONG_OPTION_END = "--";
// git commit short flags that take a value, in the same word or the next, e.g. -m "msg" or -mmsg.
const COMMIT_VALUE_LETTERS = new Set(["F", "m", "C", "c", "t"]);
// git commit short flags whose optional value is written right after them, e.g. -uno or -SKEYID.
const COMMIT_ATTACHED_VALUE_LETTERS = new Set(["u", "S"]);
const COMMIT_VALUE_OPTIONS = new Set([
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
const CONFIG_VALUE_OPTIONS = new Set(["-f", "--file", "--blob", "--type", "--default"]);
const CONFIG_READ_OPTIONS = new Set(["--get", "--get-all", "--get-regexp", "--get-urlmatch", "-l", "--list"]);
const CONFIG_UNSET_OPTIONS = new Set(["--unset", "--unset-all"]);
const CONFIG_VERBS = new Set(["get", "set", "unset"]);
const GIT_CONFIG_KEY_VARIABLE = /^GIT_CONFIG_KEY_\d+$/u;
const SHORT_OPTIONS = /^-[^-]/u;

export const SKIPPED_HOOKS_REASON =
  "git-hook-guard: This repo's git hooks run lint and typecheck before every push. Fix what they report instead of skipping them.";
export const MOVED_HOOKS_REASON =
  "git-hook-guard: Do not point git at another hooks folder or turn the hooks off. The repo's git hooks run lint and typecheck before every push. Fix what they report instead.";

const isNoVerify = (option: string): boolean =>
  option.length >= SHORTEST_NO_VERIFY_LENGTH && NO_VERIFY.startsWith(option);

const hasNoVerify = (args: ReadonlyArray<string>): boolean => {
  const optionsEnd = [...args, LONG_OPTION_END].indexOf(LONG_OPTION_END);
  const options = args.slice(0, optionsEnd);
  return options.some(isNoVerify);
};

// A cluster such as -an holds flags until a flag takes the rest of the cluster, or the next word, as its value.
const readCommitCluster = (letters: string): { readonly skipsHooks: boolean; readonly takesNextWord: boolean } => {
  const letter = letters.slice(0, 1);
  const rest = letters.slice(1);
  if (letter === "") {
    return { skipsHooks: false, takesNextWord: false };
  }

  if (letter === "n") {
    return { skipsHooks: true, takesNextWord: false };
  }

  if (COMMIT_ATTACHED_VALUE_LETTERS.has(letter)) {
    return { skipsHooks: false, takesNextWord: false };
  }

  if (COMMIT_VALUE_LETTERS.has(letter)) {
    return { skipsHooks: false, takesNextWord: rest === "" };
  }

  return readCommitCluster(rest);
};

const commitSkipsHooks = (args: ReadonlyArray<string>): boolean => {
  const [arg = "", ...rest] = args;
  const [, ...afterValue] = rest;
  if (args.length === 0 || arg === LONG_OPTION_END) {
    return false;
  }

  if (isNoVerify(arg)) {
    return true;
  }

  if (COMMIT_VALUE_OPTIONS.has(arg)) {
    return commitSkipsHooks(afterValue);
  }

  if (!SHORT_OPTIONS.test(arg)) {
    return commitSkipsHooks(rest);
  }

  const cluster = readCommitCluster(arg.slice(1));
  if (cluster.skipsHooks) {
    return true;
  }

  if (cluster.takesNextWord) {
    return commitSkipsHooks(afterValue);
  }

  return commitSkipsHooks(rest);
};

const positionalWords = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  const [arg = "", ...rest] = args;
  const [, ...afterValue] = rest;
  if (args.length === 0) {
    return [];
  }

  if (CONFIG_VALUE_OPTIONS.has(arg)) {
    return positionalWords(afterValue);
  }

  if (arg.startsWith("-")) {
    return positionalWords(rest);
  }

  return [arg, ...positionalWords(rest)];
};

const normalizedHooksPath = (hooksPath: string): string => hooksPath.replace(/^\.\//u, "").replace(/\/$/u, "");

const configChangesHooksPath = (args: ReadonlyArray<string>): boolean => {
  const words = positionalWords(args);
  const [verb = ""] = words;
  const hasVerb = CONFIG_VERBS.has(verb);
  const [key = "", value] = words.slice(Number(hasVerb));
  if (key.toLowerCase() !== HOOKS_PATH_KEY) {
    return false;
  }

  const isUnset = verb === "unset" || args.some((arg) => CONFIG_UNSET_OPTIONS.has(arg));
  if (isUnset) {
    return true;
  }

  const isRead = verb === "get" || args.some((arg) => CONFIG_READ_OPTIONS.has(arg));
  if (isRead || value === undefined) {
    return false;
  }

  return !ALLOWED_HOOKS_PATHS.has(normalizedHooksPath(value));
};

const movesHooksPathVariable = (assignment: Assignment): boolean => {
  const lowerValue = assignment.value.toLowerCase();
  if (assignment.name === "GIT_CONFIG_PARAMETERS") {
    return lowerValue.includes(HOOKS_PATH_KEY);
  }

  return GIT_CONFIG_KEY_VARIABLE.test(assignment.name) && lowerValue === HOOKS_PATH_KEY;
};

const callSkipsHooks = (gitCall: GitCall): boolean => {
  const isHookRunning = HOOK_RUNNING_SUBCOMMANDS.has(gitCall.subcommand);
  if (isHookRunning && hasNoVerify(gitCall.args)) {
    return true;
  }

  return gitCall.subcommand === "commit" && commitSkipsHooks(gitCall.args);
};

const callMovesHooks = (gitCall: GitCall): boolean => {
  const setsInlineHooksPath = gitCall.configKeys.includes(HOOKS_PATH_KEY);
  const changesConfig = gitCall.subcommand === "config" && configChangesHooksPath(gitCall.args);
  return setsInlineHooksPath || changesConfig;
};

export const skipReasonOf = (facts: CommandFacts): string | undefined => {
  const turnsHuskyOff = facts.assignments.some((assignment) => assignment.name === "HUSKY" && assignment.value === "0");
  if (turnsHuskyOff || facts.gitCalls.some(callSkipsHooks)) {
    return SKIPPED_HOOKS_REASON;
  }

  if (facts.assignments.some(movesHooksPathVariable) || facts.gitCalls.some(callMovesHooks)) {
    return MOVED_HOOKS_REASON;
  }

  return undefined;
};
