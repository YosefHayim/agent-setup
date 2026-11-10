import { escapeForPattern } from "../pattern-escape.js";
import { listShellSegments, SHELL_FIELD, type ShellSegment } from "../shell-segments.js";

export type KillTarget = {
  readonly commandWords: string;
  readonly patterns: ReadonlyArray<string>;
  readonly matchesFullCommand: boolean;
  readonly ignoresCase: boolean;
  readonly matchesWholeText: boolean;
  readonly inverted: boolean;
};

type OptionTable = {
  readonly valueFlags: ReadonlySet<string>;
  readonly longOptionLetters: ReadonlyMap<string, string>;
  readonly longValueOptions: ReadonlySet<string>;
};

type ArgumentReading = {
  readonly flags: string;
  readonly operands: ReadonlyArray<string>;
  readonly skipsNext: boolean;
  readonly optionsEnded: boolean;
};

// e.g. "pkill", "/usr/bin/killall" — not "pkill-helper"
const KILL_PROGRAM = /(?:^|\/)(?:pkill|killall)$/u;
// pgrep only lists pids, so it is judged only when its output goes on to a kill, e.g. "kill $(pgrep -f vite)"
const KILL_OR_PGREP_PROGRAM = /(?:^|\/)(?:pkill|pgrep|killall)$/u;
// e.g. -9, -KILL, -SIGTERM — not -f or -F
const SIGNAL_OPTION = /^-(?:\d+|[A-Z]{2,}\d*)$/u;
const PID_WORD = /^\d+$/u;
// e.g. bash -c 'pkill -f cat' or zsh -lc '...' — not ssh or deploy.sh
const SHELL_PROGRAM = /(?:^|\/)(?:ba|z|da|k)?sh$/u;
const COMMAND_STRING_OPTION = /^-[A-Za-z]*c[A-Za-z]*$/u;
// A shell value such as "$PATTERN" can hold any text, so it is judged as matching any text.
const ANY_STRING = ".*";
// pkill and pgrep on macOS or Linux: -u root and -P 4242 take a value, and Linux spells options long, e.g. --full
const PKILL_SETTINGS: OptionTable = {
  valueFlags: new Set(["F", "G", "J", "M", "N", "P", "U", "d", "g", "j", "r", "s", "t", "u"]),
  longOptionLetters: new Map([
    ["full", "f"],
    ["ignore-case", "i"],
    ["exact", "x"],
    ["inverse", "v"],
    ["euid", "u"],
    ["uid", "U"],
    ["group", "G"],
    ["parent", "P"],
    ["pgroup", "g"],
    ["session", "s"],
    ["terminal", "t"],
    ["pidfile", "F"],
    ["runstates", "r"],
  ]),
  longValueOptions: new Set(["signal", "ns", "nslist", "cgroup", "env", "older"]),
};
// killall on macOS (-c -t -u take a value) or Linux (-n -o -s -u -y -Z take a value, plus long options)
const KILLALL_SETTINGS: OptionTable = {
  valueFlags: new Set(["Z", "c", "n", "o", "s", "t", "u", "y"]),
  longOptionLetters: new Map([
    ["ignore-case", "I"],
    ["regexp", "r"],
    ["signal", "s"],
    ["user", "u"],
    ["older-than", "o"],
    ["younger-than", "y"],
    ["context", "Z"],
  ]),
  longValueOptions: new Set(),
};

const isProgram = (word: string, program: string): boolean => word === program || word.endsWith(`/${program}`);

const readShortSettings =
  (settings: OptionTable) =>
  (reading: ArgumentReading, argument: string): ArgumentReading => {
    const letters = argument.slice(1).split("");

    const fieldFlagIndex = letters.findIndex((letter) => settings.valueFlags.has(letter));

    const isFieldFlagMissing = fieldFlagIndex === -1;
    if (isFieldFlagMissing) {
      return { ...reading, flags: reading.flags + letters.join("") };
    }

    // A value flag ends the cluster: "-fu root" reads the next word as its value, "-uroot" carries it inline.
    const flagLetters = letters.slice(0, fieldFlagIndex).join("");
    return { ...reading, flags: reading.flags + flagLetters, skipsNext: fieldFlagIndex === letters.length - 1 };
  };

// e.g. "--full" reads as "-f", "--euid root" as "-u root", and "--euid=root" as "-uroot"
const readLongOption =
  (settings: OptionTable) =>
  (reading: ArgumentReading, argument: string): ArgumentReading => {
    const [optionName = "", ...inlineFieldParts] = argument.slice(2).split("=");
    const hasInlineField = inlineFieldParts.length > 0;
    const shortLetter = settings.longOptionLetters.get(optionName);

    const hasShortLetter = shortLetter != null;
    if (hasShortLetter) {
      const inlineField = inlineFieldParts.join("=");
      const readShortForm = readShortSettings(settings);
      return readShortForm(reading, `-${shortLetter}${inlineField}`);
    }

    const takesNextWord = settings.longValueOptions.has(optionName) && !hasInlineField;
    return { ...reading, skipsNext: takesNextWord };
  };

const readArgument = (settings: OptionTable) => {
  const readShortOption = readShortSettings(settings);
  const readLongForm = readLongOption(settings);
  return (reading: ArgumentReading, argument: string): ArgumentReading => {
    const isSkippingNext = reading.skipsNext;
    if (isSkippingNext) {
      return { ...reading, skipsNext: false };
    }

    const isOptionArgumentAfterEnd = reading.optionsEnded || !argument.startsWith("-") || argument === "-";
    if (isOptionArgumentAfterEnd) {
      return { ...reading, operands: [...reading.operands, argument] };
    }

    const isOptionEndMarker = argument === "--";
    if (isOptionEndMarker) {
      return { ...reading, optionsEnded: true };
    }

    const isLongOption = argument.startsWith("--");
    if (isLongOption) {
      return readLongForm(reading, argument);
    }

    const isSignalOption = SIGNAL_OPTION.test(argument);
    if (isSignalOption) {
      return reading;
    }

    return readShortOption(reading, argument);
  };
};

const readArguments = (argumentList: ReadonlyArray<string>, settings: OptionTable): ArgumentReading => {
  const readNext = readArgument(settings);
  return argumentList.reduce(readNext, { flags: "", operands: [], skipsNext: false, optionsEnded: false });
};

const readRegexPattern = (operand: string): string => operand.replaceAll(SHELL_FIELD, ANY_STRING);

const readExactNamePattern = (operand: string): string => {
  const literalParts = operand.split(SHELL_FIELD).map(escapeForPattern);
  return literalParts.join(ANY_STRING);
};

const readPkillTarget = (commandWords: string, argumentList: ReadonlyArray<string>): KillTarget => {
  const reading = readArguments(argumentList, PKILL_SETTINGS);
  return {
    commandWords,
    patterns: reading.operands.map(readRegexPattern),
    matchesFullCommand: reading.flags.includes("f"),
    ignoresCase: reading.flags.includes("i"),
    matchesWholeText: reading.flags.includes("x"),
    inverted: reading.flags.includes("v"),
  };
};

const readKillallTarget = (commandWords: string, argumentList: ReadonlyArray<string>): KillTarget => {
  const reading = readArguments(argumentList, KILLALL_SETTINGS);
  // macOS killall -m and Linux killall -r take regular expressions; Linux killall -I ignores case.
  const isUsingRegex = reading.flags.includes("m") || reading.flags.includes("r");
  const patterns = reading.operands.map(isUsingRegex ? readRegexPattern : readExactNamePattern);
  return {
    commandWords,
    patterns,
    matchesFullCommand: false,
    ignoresCase: reading.flags.includes("I"),
    matchesWholeText: !isUsingRegex,
    inverted: false,
  };
};

// e.g. "kill $(pgrep -f vite)" or "pgrep -f vite | xargs kill"; "kill 4242" names its pids and takes none from pgrep.
const isKillingUnnamedProcesses = (segment: ShellSegment): boolean => {
  const killIndex = segment.words.findIndex((word) => isProgram(word, "kill"));

  const isKillMissing = killIndex === -1;
  if (isKillMissing) {
    return false;
  }

  const pidWords = segment.words.slice(killIndex + 1).filter((word) => !word.startsWith("-"));
  return pidWords.length === 0 || pidWords.some((word) => !PID_WORD.test(word));
};

const listKillTargetsInSegment = (segment: ReadonlyArray<string>, judgedProgram: RegExp): ReadonlyArray<KillTarget> => {
  const programIndex = segment.findIndex((word) => judgedProgram.test(word));

  const isProgramMissing = programIndex === -1;
  if (isProgramMissing) {
    return [];
  }

  const programWords = segment.slice(programIndex);
  const [programPath = "", ...argumentList] = programWords;
  const commandWords = programWords.join(" ").replaceAll(SHELL_FIELD, "$...");

  if (isProgram(programPath, "killall")) {
    return [readKillallTarget(commandWords, argumentList)];
  }

  return [readPkillTarget(commandWords, argumentList)];
};

// e.g. the pgrep in "kill $(pgrep -f vite)", "pids=`pgrep -f vite`", or "pgrep -f vite | xargs kill"
const isPassingOnItsPrintout = (segment: ShellSegment): boolean =>
  segment.openedBy === "(" || segment.openedBy === "`" || segment.closedBy === "|";

const listShellCommandString = (segment: ShellSegment): ReadonlyArray<string> => {
  const shellIndex = segment.words.findIndex((word) => SHELL_PROGRAM.test(word));
  const shellArguments = segment.words.slice(shellIndex + 1);
  const optionIndex = shellArguments.findIndex((word) => COMMAND_STRING_OPTION.test(word));

  const commandString = shellArguments[optionIndex + 1];

  const isShellCommandMissing = shellIndex === -1 || optionIndex === -1 || commandString == null;
  if (isShellCommandMissing) {
    return [];
  }

  return [commandString];
};

// eval joins its words and runs them as a new command, e.g. eval "pkill -f $PATTERN".
const listEvalCommand = (segment: ShellSegment): ReadonlyArray<string> => {
  const [program, ...evalWords] = segment.words;

  const isProgramNotEval = program !== "eval";
  if (isProgramNotEval) {
    return [];
  }

  return [evalWords.join(" ")];
};

// A kill with no pattern, e.g. "pkill -P 4242", selects by parent or user, which this guard does not judge.
export const listKillTargetsIn = (command: string): ReadonlyArray<KillTarget> => {
  const segments = listShellSegments(command);
  const killsUnnamed = segments.some(isKillingUnnamedProcesses);
  const directTargets = segments
    .flatMap((segment) => {
      const isFeedingKill = killsUnnamed && isPassingOnItsPrintout(segment);
      const judgedProgram = isFeedingKill ? KILL_OR_PGREP_PROGRAM : KILL_PROGRAM;
      return listKillTargetsInSegment(segment.words, judgedProgram);
    })
    .filter((killTarget) => killTarget.patterns.length > 0);
  const nestedCommands = segments.flatMap((segment) => [
    ...listShellCommandString(segment),
    ...listEvalCommand(segment),
  ]);
  const nestedTargets = nestedCommands.flatMap((nestedCommand) => listKillTargetsIn(nestedCommand));
  return [...directTargets, ...nestedTargets];
};
