import { escapeForPattern } from "../../lib/patternEscape.js";
import { SHELL_VALUE, type ShellSegment, shellSegments } from "./shellSegments.js";

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
const ANY_TEXT = ".*";
// pkill and pgrep on macOS or Linux: -u root and -P 4242 take a value, and Linux spells options long, e.g. --full
const PKILL_OPTIONS: OptionTable = {
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
const KILLALL_OPTIONS: OptionTable = {
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

const readShortOptions =
  (options: OptionTable) =>
  (reading: ArgumentReading, argument: string): ArgumentReading => {
    const letters = argument.slice(1).split("");
    const valueFlagIndex = letters.findIndex((letter) => options.valueFlags.has(letter));
    if (valueFlagIndex === -1) {
      return { ...reading, flags: reading.flags + letters.join("") };
    }

    // A value flag ends the cluster: "-fu root" reads the next word as its value, "-uroot" carries it inline.
    const flagLetters = letters.slice(0, valueFlagIndex).join("");
    return { ...reading, flags: reading.flags + flagLetters, skipsNext: valueFlagIndex === letters.length - 1 };
  };

// e.g. "--full" reads as "-f", "--euid root" as "-u root", and "--euid=root" as "-uroot"
const readLongOption =
  (options: OptionTable) =>
  (reading: ArgumentReading, argument: string): ArgumentReading => {
    const [optionName = "", ...inlineValueParts] = argument.slice(2).split("=");
    const hasInlineValue = inlineValueParts.length > 0;
    const shortLetter = options.longOptionLetters.get(optionName);
    if (shortLetter !== undefined) {
      const inlineValue = inlineValueParts.join("=");
      const readShortForm = readShortOptions(options);
      return readShortForm(reading, `-${shortLetter}${inlineValue}`);
    }

    const takesNextWord = options.longValueOptions.has(optionName) && !hasInlineValue;
    return { ...reading, skipsNext: takesNextWord };
  };

const readArgument = (options: OptionTable) => {
  const readShortOption = readShortOptions(options);
  const readLongForm = readLongOption(options);
  return (reading: ArgumentReading, argument: string): ArgumentReading => {
    if (reading.skipsNext) {
      return { ...reading, skipsNext: false };
    }

    if (reading.optionsEnded || !argument.startsWith("-") || argument === "-") {
      return { ...reading, operands: [...reading.operands, argument] };
    }

    if (argument === "--") {
      return { ...reading, optionsEnded: true };
    }

    if (argument.startsWith("--")) {
      return readLongForm(reading, argument);
    }

    if (SIGNAL_OPTION.test(argument)) {
      return reading;
    }

    return readShortOption(reading, argument);
  };
};

const readArguments = (argumentList: ReadonlyArray<string>, options: OptionTable): ArgumentReading => {
  const readNext = readArgument(options);
  return argumentList.reduce(readNext, { flags: "", operands: [], skipsNext: false, optionsEnded: false });
};

const regexPatternOf = (operand: string): string => operand.replaceAll(SHELL_VALUE, ANY_TEXT);

const exactNamePatternOf = (operand: string): string => {
  const literalParts = operand.split(SHELL_VALUE).map(escapeForPattern);
  return literalParts.join(ANY_TEXT);
};

const pkillTarget = (commandWords: string, argumentList: ReadonlyArray<string>): KillTarget => {
  const reading = readArguments(argumentList, PKILL_OPTIONS);
  return {
    commandWords,
    patterns: reading.operands.map(regexPatternOf),
    matchesFullCommand: reading.flags.includes("f"),
    ignoresCase: reading.flags.includes("i"),
    matchesWholeText: reading.flags.includes("x"),
    inverted: reading.flags.includes("v"),
  };
};

const killallTarget = (commandWords: string, argumentList: ReadonlyArray<string>): KillTarget => {
  const reading = readArguments(argumentList, KILLALL_OPTIONS);
  // macOS killall -m and Linux killall -r take regular expressions; Linux killall -I ignores case.
  const usesRegex = reading.flags.includes("m") || reading.flags.includes("r");
  const patterns = reading.operands.map(usesRegex ? regexPatternOf : exactNamePatternOf);
  return {
    commandWords,
    patterns,
    matchesFullCommand: false,
    ignoresCase: reading.flags.includes("I"),
    matchesWholeText: !usesRegex,
    inverted: false,
  };
};

// e.g. "kill $(pgrep -f vite)" or "pgrep -f vite | xargs kill"; "kill 4242" names its pids and takes none from pgrep.
const killsUnnamedProcesses = (segment: ShellSegment): boolean => {
  const killIndex = segment.words.findIndex((word) => isProgram(word, "kill"));
  if (killIndex === -1) {
    return false;
  }

  const pidWords = segment.words.slice(killIndex + 1).filter((word) => !word.startsWith("-"));
  return pidWords.length === 0 || pidWords.some((word) => !PID_WORD.test(word));
};

const killTargetsInSegment = (segment: ReadonlyArray<string>, judgedProgram: RegExp): ReadonlyArray<KillTarget> => {
  const programIndex = segment.findIndex((word) => judgedProgram.test(word));
  if (programIndex === -1) {
    return [];
  }

  const programWords = segment.slice(programIndex);
  const [programPath = "", ...argumentList] = programWords;
  const commandWords = programWords.join(" ").replaceAll(SHELL_VALUE, "$...");
  if (isProgram(programPath, "killall")) {
    return [killallTarget(commandWords, argumentList)];
  }

  return [pkillTarget(commandWords, argumentList)];
};

// e.g. the pgrep in "kill $(pgrep -f vite)", "pids=`pgrep -f vite`", or "pgrep -f vite | xargs kill"
const passesOnItsOutput = (segment: ShellSegment): boolean =>
  segment.openedBy === "(" || segment.openedBy === "`" || segment.closedBy === "|";

const shellCommandStringOf = (segment: ShellSegment): ReadonlyArray<string> => {
  const shellIndex = segment.words.findIndex((word) => SHELL_PROGRAM.test(word));
  const shellArguments = segment.words.slice(shellIndex + 1);
  const optionIndex = shellArguments.findIndex((word) => COMMAND_STRING_OPTION.test(word));
  const commandString = shellArguments[optionIndex + 1];
  if (shellIndex === -1 || optionIndex === -1 || commandString === undefined) {
    return [];
  }

  return [commandString];
};

// eval joins its words and runs them as a new command, e.g. eval "pkill -f $PATTERN".
const evalCommandOf = (segment: ShellSegment): ReadonlyArray<string> => {
  const [program, ...evalWords] = segment.words;
  if (program !== "eval") {
    return [];
  }

  return [evalWords.join(" ")];
};

// A kill with no pattern, e.g. "pkill -P 4242", selects by parent or user, which this guard does not judge.
export const killTargetsIn = (command: string): ReadonlyArray<KillTarget> => {
  const segments = shellSegments(command);
  const killsUnnamed = segments.some(killsUnnamedProcesses);
  const directTargets = segments
    .flatMap((segment) => {
      const feedsKill = killsUnnamed && passesOnItsOutput(segment);
      const judgedProgram = feedsKill ? KILL_OR_PGREP_PROGRAM : KILL_PROGRAM;
      return killTargetsInSegment(segment.words, judgedProgram);
    })
    .filter((killTarget) => killTarget.patterns.length > 0);
  const nestedCommands = segments.flatMap((segment) => [...shellCommandStringOf(segment), ...evalCommandOf(segment)]);
  const nestedTargets = nestedCommands.flatMap((nestedCommand) => killTargetsIn(nestedCommand));
  return [...directTargets, ...nestedTargets];
};
