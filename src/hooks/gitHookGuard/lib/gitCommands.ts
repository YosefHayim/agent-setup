import { type ShellSegment, shellSegments } from "../../lib/shellSegments.js";

export type Assignment = {
  readonly name: string;
  readonly value: string;
};

export type GitCall = {
  readonly configKeys: ReadonlyArray<string>;
  readonly repoFolders: ReadonlyArray<string>;
  readonly changedFolder: string | undefined;
  readonly subcommand: string;
  readonly args: ReadonlyArray<string>;
};

export type CommandFacts = {
  readonly assignments: ReadonlyArray<Assignment>;
  readonly gitCalls: ReadonlyArray<GitCall>;
  readonly changedFolder: string | undefined;
};

type GlobalOptions = {
  readonly configKeys: ReadonlyArray<string>;
  readonly repoFolders: ReadonlyArray<string>;
};

type ParsedGit = {
  readonly options: GlobalOptions;
  readonly subcommandWords: ReadonlyArray<string>;
};

const ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/su;
const GIT_PROGRAM = /(?:^|\/)git$/u;
const SHELL_PROGRAM = /(?:^|\/)(?:ba|z|da|k)?sh$/u;
const COMMAND_STRING_OPTION = /^-[A-Za-z]*c[A-Za-z]*$/u;
// Words that may stand before the program and pass it environment, e.g. "export HUSKY=0" or "env -i HUSKY=0 git push".
const PREFIX_PROGRAMS = new Set(["export", "env", "command", "exec", "nohup", "sudo", "time", "builtin"]);
// git options before the subcommand that take the next word as their value, e.g. git -C ../app push.
const GLOBAL_VALUE_OPTIONS = new Set(["--git-dir", "--work-tree", "--namespace", "--super-prefix", "--attr-source"]);
const CONFIG_ENV_PREFIX = "--config-env=";

const configKeyOf = (setting: string): string => {
  const [configKey = ""] = setting.split("=");
  return configKey.toLowerCase();
};

const globalOptionsOf = (words: ReadonlyArray<string>, before: GlobalOptions): ParsedGit => {
  const [word = "", ...afterWord] = words;
  const [value = "", ...afterValue] = afterWord;
  if (word === "-C") {
    return globalOptionsOf(afterValue, { ...before, repoFolders: [...before.repoFolders, value] });
  }

  if (word === "-c" || word === "--config-env") {
    return globalOptionsOf(afterValue, { ...before, configKeys: [...before.configKeys, configKeyOf(value)] });
  }

  if (word.startsWith(CONFIG_ENV_PREFIX)) {
    const configKey = configKeyOf(word.slice(CONFIG_ENV_PREFIX.length));
    return globalOptionsOf(afterWord, { ...before, configKeys: [...before.configKeys, configKey] });
  }

  if (GLOBAL_VALUE_OPTIONS.has(word)) {
    return globalOptionsOf(afterValue, before);
  }

  if (word.startsWith("-")) {
    return globalOptionsOf(afterWord, before);
  }

  return { options: before, subcommandWords: words };
};

const gitCallOf = (gitArguments: ReadonlyArray<string>, changedFolder: string | undefined): GitCall => {
  const parsedGit = globalOptionsOf(gitArguments, { configKeys: [], repoFolders: [] });
  const [subcommand = "", ...args] = parsedGit.subcommandWords;
  return { ...parsedGit.options, changedFolder, subcommand, args };
};

const isPrefixWord = (word: string, firstWord: string): boolean => {
  const isAssignment = ASSIGNMENT.test(word);
  const isPrefixProgram = PREFIX_PROGRAMS.has(word);
  const isOptionOfPrefixProgram = word.startsWith("-") && PREFIX_PROGRAMS.has(firstWord);
  return isAssignment || isPrefixProgram || isOptionOfPrefixProgram;
};

const assignmentOf = (word: string): ReadonlyArray<Assignment> => {
  const assignment = ASSIGNMENT.exec(word);
  if (!assignment) {
    return [];
  }

  const [, name = "", value = ""] = assignment;
  return [{ name, value }];
};

const commandStringOf = (programArguments: ReadonlyArray<string>): string | undefined => {
  const optionIndex = programArguments.findIndex((word) => COMMAND_STRING_OPTION.test(word));
  if (optionIndex === -1) {
    return undefined;
  }

  return programArguments[optionIndex + 1];
};

const folderChangedBy = (cdArguments: ReadonlyArray<string>, before: string | undefined): string | undefined => {
  const folder = cdArguments.find((word) => !word.startsWith("-"));
  if (folder === undefined || folder === "-") {
    return before;
  }

  return folder;
};

const EMPTY_FACTS: CommandFacts = { assignments: [], gitCalls: [], changedFolder: undefined };

const joinFacts = (earlier: CommandFacts, later: CommandFacts): CommandFacts => ({
  assignments: [...earlier.assignments, ...later.assignments],
  gitCalls: [...earlier.gitCalls, ...later.gitCalls],
  changedFolder: later.changedFolder,
});

const segmentFacts = (segment: ShellSegment, changedFolder: string | undefined): CommandFacts => {
  const [firstWord = ""] = segment.words;
  // The empty word at the end is never a prefix word, so a segment of only prefix words ends at its own length.
  const programIndex = [...segment.words, ""].findIndex((word) => !isPrefixWord(word, firstWord));
  const hasProgram = programIndex < segment.words.length;
  const assignments = segment.words.slice(0, programIndex).flatMap(assignmentOf);
  if (!hasProgram) {
    return { assignments, gitCalls: [], changedFolder };
  }

  const [program = "", ...programArguments] = segment.words.slice(programIndex);
  if (GIT_PROGRAM.test(program)) {
    return { assignments, gitCalls: [gitCallOf(programArguments, changedFolder)], changedFolder };
  }

  if (program === "cd") {
    return { assignments, gitCalls: [], changedFolder: folderChangedBy(programArguments, changedFolder) };
  }

  if (program === "eval") {
    const evaluated = commandFactsIn(programArguments.join(" "), changedFolder);
    return { ...evaluated, assignments: [...assignments, ...evaluated.assignments] };
  }

  const commandString = commandStringOf(programArguments);
  if (SHELL_PROGRAM.test(program) && commandString !== undefined) {
    const nested = commandFactsIn(commandString, changedFolder);
    return { ...nested, assignments: [...assignments, ...nested.assignments] };
  }

  return { assignments, gitCalls: [], changedFolder };
};

// Reads every environment assignment and git call of a shell command, including the ones inside bash -c "...", with the
// folder the last cd before each git call moved to.
export const commandFactsIn = (command: string, startFolder: string | undefined): CommandFacts =>
  shellSegments(command).reduce((facts, segment) => joinFacts(facts, segmentFacts(segment, facts.changedFolder)), {
    ...EMPTY_FACTS,
    changedFolder: startFolder,
  });
