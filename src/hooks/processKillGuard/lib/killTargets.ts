import { escapeForPattern } from "../../lib/patternEscape.js";
import { shellSegments } from "./shellSegments.js";

export type KillTarget = {
  readonly commandWords: string;
  readonly patterns: ReadonlyArray<string>;
  readonly matchesFullCommand: boolean;
  readonly ignoresCase: boolean;
  readonly matchesWholeText: boolean;
  readonly inverted: boolean;
};

type ArgumentReading = {
  readonly flags: string;
  readonly operands: ReadonlyArray<string>;
  readonly skipsNext: boolean;
  readonly optionsEnded: boolean;
};

// e.g. "pkill", "/usr/bin/killall" — not "pkill-helper"
const KILL_PROGRAM = /(?:^|\/)(?:pkill|killall)$/u;
// pgrep only lists pids, so it is judged only when a kill takes them, e.g. "kill $(pgrep -f vite)"
const KILL_OR_PGREP_PROGRAM = /(?:^|\/)(?:pkill|pgrep|killall)$/u;
// e.g. -9, -KILL, -SIGTERM — not -f or -F
const SIGNAL_OPTION = /^-(?:\d+|[A-Z]{2,}\d*)$/u;
const PID_WORD = /^\d+$/u;
// pkill and pgrep options that take a value on macOS or Linux, e.g. -u root or -P 4242
const PKILL_VALUE_FLAGS = new Set(["F", "G", "J", "M", "N", "P", "U", "d", "g", "j", "r", "s", "t", "u"]);
// killall options that take a value on macOS (-c -t -u) or Linux (-n -o -s -u -y -Z)
const KILLALL_VALUE_FLAGS = new Set(["Z", "c", "n", "o", "s", "t", "u", "y"]);

const isProgram = (word: string, program: string): boolean => word === program || word.endsWith(`/${program}`);

const readArgument =
  (valueFlags: ReadonlySet<string>) =>
  (reading: ArgumentReading, argument: string): ArgumentReading => {
    if (reading.skipsNext) {
      return { ...reading, skipsNext: false };
    }

    if (reading.optionsEnded || !argument.startsWith("-") || argument === "-") {
      return { ...reading, operands: [...reading.operands, argument] };
    }

    if (argument === "--") {
      return { ...reading, optionsEnded: true };
    }

    if (argument.startsWith("--") || SIGNAL_OPTION.test(argument)) {
      return reading;
    }

    const letters = argument.slice(1).split("");
    const valueFlagIndex = letters.findIndex((letter) => valueFlags.has(letter));
    if (valueFlagIndex === -1) {
      return { ...reading, flags: reading.flags + letters.join("") };
    }

    // A value flag ends the cluster: "-fu root" reads the next word as its value, "-uroot" carries it inline.
    const flagLetters = letters.slice(0, valueFlagIndex).join("");
    return { ...reading, flags: reading.flags + flagLetters, skipsNext: valueFlagIndex === letters.length - 1 };
  };

const readArguments = (argumentList: ReadonlyArray<string>, valueFlags: ReadonlySet<string>): ArgumentReading => {
  const readNext = readArgument(valueFlags);
  return argumentList.reduce(readNext, { flags: "", operands: [], skipsNext: false, optionsEnded: false });
};

const pkillTarget = (commandWords: string, argumentList: ReadonlyArray<string>): KillTarget => {
  const reading = readArguments(argumentList, PKILL_VALUE_FLAGS);
  return {
    commandWords,
    patterns: reading.operands,
    matchesFullCommand: reading.flags.includes("f"),
    ignoresCase: reading.flags.includes("i"),
    matchesWholeText: reading.flags.includes("x"),
    inverted: reading.flags.includes("v"),
  };
};

const killallTarget = (commandWords: string, argumentList: ReadonlyArray<string>): KillTarget => {
  const reading = readArguments(argumentList, KILLALL_VALUE_FLAGS);
  // macOS killall -m and Linux killall -r take regular expressions; Linux killall -I ignores case.
  const usesRegex = reading.flags.includes("m") || reading.flags.includes("r");
  const patterns = usesRegex ? reading.operands : reading.operands.map(escapeForPattern);
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
const killsUnnamedProcesses = (segment: ReadonlyArray<string>): boolean => {
  const killIndex = segment.findIndex((word) => isProgram(word, "kill"));
  if (killIndex === -1) {
    return false;
  }

  const pidWords = segment.slice(killIndex + 1).filter((word) => !word.startsWith("-"));
  return pidWords.length === 0 || pidWords.some((word) => !PID_WORD.test(word));
};

const killTargetsInSegment = (segment: ReadonlyArray<string>, judgedProgram: RegExp): ReadonlyArray<KillTarget> => {
  const programIndex = segment.findIndex((word) => judgedProgram.test(word));
  if (programIndex === -1) {
    return [];
  }

  const programWords = segment.slice(programIndex);
  const [programPath = "", ...argumentList] = programWords;
  const commandWords = programWords.join(" ");
  if (isProgram(programPath, "killall")) {
    return [killallTarget(commandWords, argumentList)];
  }

  return [pkillTarget(commandWords, argumentList)];
};

// A kill with no pattern, e.g. "pkill -P 4242", selects by parent or user, which this guard does not judge.
export const killTargetsIn = (command: string): ReadonlyArray<KillTarget> => {
  const segments = shellSegments(command);
  const judgedProgram = segments.some(killsUnnamedProcesses) ? KILL_OR_PGREP_PROGRAM : KILL_PROGRAM;
  return segments
    .flatMap((segment) => killTargetsInSegment(segment, judgedProgram))
    .filter((killTarget) => killTarget.patterns.length > 0);
};
