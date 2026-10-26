import { spawnSync } from "node:child_process";

// A remote that wants a password has to fail, since nobody is there to type one: git may ask neither on the terminal
// nor through a helper program, and neither may ssh. An empty GIT_ASKPASS also rules out core.askPass and SSH_ASKPASS.
const NO_PASSWORD_QUESTIONS = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS_REQUIRE: "never" };

// The variables `git rev-parse --local-env-vars` lists. Git sets some of them inside its own hooks, and inherited they
// would point every call at that repository; the rest, such as GIT_SSH_COMMAND, are the person's own setup.
const REPOSITORY_VARIABLES = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
]);

const gitEnvironment = (): NodeJS.ProcessEnv => {
  const variables = Object.entries(process.env).filter(([name]) => !REPOSITORY_VARIABLES.has(name));
  return { ...Object.fromEntries(variables), ...NO_PASSWORD_QUESTIONS };
};

export type GitQuestion = {
  readonly folder: string;
  readonly query: ReadonlyArray<string>;
  readonly ignoredLine?: RegExp;
  readonly timeoutMilliseconds?: number;
};

const runGit = (question: GitQuestion) =>
  // --no-optional-locks keeps this read from blocking an agent that is using the same work tree.
  spawnSync("git", ["--no-optional-locks", "-C", question.folder, ...question.query], {
    encoding: "utf8",
    env: gitEnvironment(),
    timeout: question.timeoutMilliseconds,
  });

// A git call that fails or runs out of time has no answer, which is not the same as an empty one.
export const gitAnswerLines = (question: GitQuestion): ReadonlyArray<string> | undefined => {
  const git = runGit(question);
  if (git.status !== 0) {
    return undefined;
  }

  return git.stdout.split("\n").filter((line) => line !== "");
};

// What git said on stderr when the call failed, "" when it said nothing, and undefined when the call succeeded.
export const gitFailureText = (question: GitQuestion): string | undefined => {
  const git = runGit(question);
  if (git.status === 0) {
    return undefined;
  }

  return git.stderr || "";
};

export const gitSucceeds = (question: GitQuestion): boolean => gitAnswerLines(question) !== undefined;

// A git call that fails cannot vouch for the work tree, so only a successful empty answer counts as nothing.
export const gitFindsNothing = (question: GitQuestion): boolean => {
  const answerLines = gitAnswerLines(question);
  if (!answerLines) {
    return false;
  }

  const countedLines = answerLines.filter((line) => !question.ignoredLine?.test(line));
  return countedLines.length === 0;
};
