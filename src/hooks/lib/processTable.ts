import { spawnSync } from "node:child_process";

export type RunningProcess = {
  readonly processId: number;
  readonly parentProcessId: number;
  readonly name: string;
  readonly commandLine: string;
  readonly elapsedSeconds: number;
};

// e.g. "  412     1 cmux" — ucomm is the short name pkill and killall match without -f, and may hold spaces
const NAME_LINE = /^\s*(\d+)\s+(\d+)\s(.*)$/u;
// e.g. "  412 02-03:04:05 /Applications/cmux.app/Contents/MacOS/cmux --flag"
const COMMAND_LINE = /^\s*(\d+)\s+(\S+)\s(.*)$/u;
// e.g. "03:04", "01:03:04" or "2-01:03:04" (days-hours:minutes:seconds, the left parts only when nonzero)
const ELAPSED_TIME = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/u;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;

// Full command lines of every process can pass Node's default 1 MiB output limit, which cuts the listing short.
const PS_OUTPUT_LIMIT = 64 * 1024 * 1024;

// A failed or cut-short listing throws, so the hook fails open instead of judging part of the table.
const psLines = (columns: string): ReadonlyArray<string> => {
  const listing = spawnSync("ps", ["-A", "-ww", "-o", columns], { encoding: "utf8", maxBuffer: PS_OUTPUT_LIMIT });
  if (listing.error) {
    throw listing.error;
  }

  return listing.stdout.split("\n");
};

// ps prints the time a process has run as [[days-]hours:]minutes:seconds; a text in another shape counts as 0.
export const elapsedSecondsOf = (elapsedText: string): number => {
  const parts = ELAPSED_TIME.exec(elapsedText);
  if (!parts) {
    return 0;
  }

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = parts;
  return (
    Number(days) * SECONDS_PER_DAY +
    Number(hours) * SECONDS_PER_HOUR +
    Number(minutes) * SECONDS_PER_MINUTE +
    Number(seconds)
  );
};

interface CommandEntry {
  readonly commandLine: string;
  readonly elapsedSeconds: number;
}

const commandLineEntryOf = (line: string): ReadonlyArray<readonly [number, CommandEntry]> => {
  const match = COMMAND_LINE.exec(line);
  if (!match) {
    return [];
  }

  const [, processIdText = "", elapsedText = "", commandLine = ""] = match;
  return [[Number(processIdText), { commandLine, elapsedSeconds: elapsedSecondsOf(elapsedText) }]];
};

// A process that started between the two ps runs has no command line and is left out.
const runningProcessOf = (
  line: string,
  commandEntries: ReadonlyMap<number, CommandEntry>,
): ReadonlyArray<RunningProcess> => {
  const match = NAME_LINE.exec(line);
  if (!match) {
    return [];
  }

  const [, processIdText = "", parentProcessIdText = "", nameText = ""] = match;
  const processId = Number(processIdText);
  const commandEntry = commandEntries.get(processId);
  if (commandEntry === undefined) {
    return [];
  }

  return [{ processId, parentProcessId: Number(parentProcessIdText), name: nameText.trim(), ...commandEntry }];
};

export const runningProcesses = (): ReadonlyArray<RunningProcess> => {
  const commandLineEntries = psLines("pid=,etime=,command=").flatMap(commandLineEntryOf);
  const commandEntries = new Map(commandLineEntries);
  return psLines("pid=,ppid=,ucomm=").flatMap((line) => runningProcessOf(line, commandEntries));
};
