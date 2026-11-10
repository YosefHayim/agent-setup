import { listShellSegments, type ShellSegment } from "../shell-segments.js";

export type Assignment = {
  readonly name: string;
  readonly value: string;
};

export type GitCall = {
  readonly configKeys: ReadonlyArray<string>;
  readonly repoFolders: ReadonlyArray<string>;
  readonly changedFolder: string | null;
  readonly subcommand: string;
  readonly args: ReadonlyArray<string>;
};

export type CommandFacts = {
  readonly assignments: ReadonlyArray<Assignment>;
  readonly gitCalls: ReadonlyArray<GitCall>;
  readonly changedFolder: string | null;
};

type GlobalSettings = {
  readonly configKeys: ReadonlyArray<string>;
  readonly repoFolders: ReadonlyArray<string>;
};

type ParsedGit = {
  readonly options: GlobalSettings;
  readonly subcommandWords: ReadonlyArray<string>;
};

const ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/su;
const GIT_PROGRAM = /(?:^|\/)git$/u;
const SHELL_PROGRAM = /(?:^|\/)(?:ba|z|da|k)?sh$/u;
const COMMAND_STRING_OPTION = /^-[A-Za-z]*c[A-Za-z]*$/u;
// Words that may stand before the program and pass it environment, e.g. "export HUSKY=0" or "env -i HUSKY=0 git push".
const PREFIX_PROGRAMS = new Set(["export", "env", "command", "exec", "nohup", "sudo", "time", "builtin"]);
// git options before the subcommand that take the next word as their value, e.g. git -C ../app push.
const GLOBAL_FIELD_SETTINGS = new Set(["--git-dir", "--work-tree", "--namespace", "--super-prefix", "--attr-source"]);
const SETTINGS_ENVIRONMENT_PREFIX = "--config-env=";

const readSettingsKey = (setting: string): string => {
  const [settingsKey = ""] = setting.split("=");
  return settingsKey.toLowerCase();
};

const readGlobalSettings = (words: ReadonlyArray<string>, before: GlobalSettings): ParsedGit => {
  const [word = "", ...afterWord] = words;
  const [field = "", ...afterField] = afterWord;

  const isDirectoryOption = word === "-C";
  if (isDirectoryOption) {
    return readGlobalSettings(afterField, { ...before, repoFolders: [...before.repoFolders, field] });
  }

  const isInlineSettingFlag = word === "-c" || word === "--config-env";
  if (isInlineSettingFlag) {
    return readGlobalSettings(afterField, { ...before, configKeys: [...before.configKeys, readSettingsKey(field)] });
  }

  const isSettingsEnvironmentWord = word.startsWith(SETTINGS_ENVIRONMENT_PREFIX);
  if (isSettingsEnvironmentWord) {
    const settingsKey = readSettingsKey(word.slice(SETTINGS_ENVIRONMENT_PREFIX.length));
    return readGlobalSettings(afterWord, { ...before, configKeys: [...before.configKeys, settingsKey] });
  }

  const isGlobalSettingWord = GLOBAL_FIELD_SETTINGS.has(word);
  if (isGlobalSettingWord) {
    return readGlobalSettings(afterField, before);
  }

  const isOptionWord = word.startsWith("-");
  if (isOptionWord) {
    return readGlobalSettings(afterWord, before);
  }

  return { options: before, subcommandWords: words };
};

const readGitCall = (gitArguments: ReadonlyArray<string>, changedFolder: string | null): GitCall => {
  const parsedGit = readGlobalSettings(gitArguments, { configKeys: [], repoFolders: [] });
  const [subcommand = "", ...argumentList] = parsedGit.subcommandWords;
  return { ...parsedGit.options, changedFolder, subcommand, args: argumentList };
};

const isPrefixWord = (word: string, firstWord: string): boolean => {
  const isAssignment = ASSIGNMENT.test(word);
  const isPrefixProgram = PREFIX_PROGRAMS.has(word);
  const isOptionOfPrefixProgram = word.startsWith("-") && PREFIX_PROGRAMS.has(firstWord);
  return isAssignment || isPrefixProgram || isOptionOfPrefixProgram;
};

const listAssignmentOf = (word: string): ReadonlyArray<Assignment> => {
  const assignment = ASSIGNMENT.exec(word);

  const hasNoAssignment = !assignment;
  if (hasNoAssignment) {
    return [];
  }

  const [, name = "", field = ""] = assignment;
  return [{ name, value: field }];
};

const readCommandString = (programArguments: ReadonlyArray<string>): string | null => {
  const optionIndex = programArguments.findIndex((word) => COMMAND_STRING_OPTION.test(word));

  const isOptionMissing = optionIndex === -1;
  if (isOptionMissing) {
    return null;
  }

  return programArguments[optionIndex + 1];
};

const readFolderChangedBy = (cdArguments: ReadonlyArray<string>, before: string | null): string | null => {
  const folder = cdArguments.find((word) => !word.startsWith("-"));

  const isFolderUnspecified = folder == null || folder === "-";
  if (isFolderUnspecified) {
    return before;
  }

  return folder;
};

const EMPTY_FACTS: CommandFacts = { assignments: [], gitCalls: [], changedFolder: null };

const joinFacts = (earlier: CommandFacts, later: CommandFacts): CommandFacts => ({
  assignments: [...earlier.assignments, ...later.assignments],
  gitCalls: [...earlier.gitCalls, ...later.gitCalls],
  changedFolder: later.changedFolder,
});

const readSegmentFacts = (segment: ShellSegment, changedFolder: string | null): CommandFacts => {
  const [firstWord = ""] = segment.words;
  // The empty word at the end is never a prefix word, so a segment of only prefix words ends at its own length.
  const programIndex = [...segment.words, ""].findIndex((word) => !isPrefixWord(word, firstWord));
  const hasProgram = programIndex < segment.words.length;
  const assignments = segment.words.slice(0, programIndex).flatMap(listAssignmentOf);

  if (!hasProgram) {
    return { assignments, gitCalls: [], changedFolder };
  }

  const [program = "", ...programArguments] = segment.words.slice(programIndex);

  const isGitProgram = GIT_PROGRAM.test(program);
  if (isGitProgram) {
    return { assignments, gitCalls: [readGitCall(programArguments, changedFolder)], changedFolder };
  }

  const isProgramCd = program === "cd";
  if (isProgramCd) {
    return { assignments, gitCalls: [], changedFolder: readFolderChangedBy(programArguments, changedFolder) };
  }

  const isProgramEval = program === "eval";
  if (isProgramEval) {
    const evaluated = readCommandFactsIn(programArguments.join(" "), changedFolder);
    return { ...evaluated, assignments: [...assignments, ...evaluated.assignments] };
  }

  const commandString = readCommandString(programArguments);

  const isShellWithCommand = SHELL_PROGRAM.test(program) && commandString != null;
  if (isShellWithCommand) {
    const nested = readCommandFactsIn(commandString, changedFolder);
    return { ...nested, assignments: [...assignments, ...nested.assignments] };
  }

  return { assignments, gitCalls: [], changedFolder };
};

// Reads every environment assignment and git call of a shell command, including the ones inside bash -c "...", with the
// folder the last cd before each git call moved to.
export const readCommandFactsIn = (command: string, startFolder: string | null): CommandFacts =>
  listShellSegments(command).reduce(
    (facts, segment) => joinFacts(facts, readSegmentFacts(segment, facts.changedFolder)),
    {
      ...EMPTY_FACTS,
      changedFolder: startFolder,
    },
  );
