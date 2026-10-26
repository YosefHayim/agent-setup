import { spawnSync } from "node:child_process";

export type RunningProcess = {
  readonly processId: number;
  readonly parentProcessId: number;
  readonly name: string;
  readonly commandLine: string;
};

// e.g. "  412     1 cmux" — ucomm is the short name pkill and killall match without -f, and may hold spaces
const NAME_LINE = /^\s*(\d+)\s+(\d+)\s(.*)$/u;
// e.g. "  412 /Applications/cmux.app/Contents/MacOS/cmux --flag"
const COMMAND_LINE = /^\s*(\d+)\s(.*)$/u;

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

const commandLineEntryOf = (line: string): ReadonlyArray<readonly [number, string]> => {
  const match = COMMAND_LINE.exec(line);
  if (!match) {
    return [];
  }

  const [, processIdText = "", commandLine = ""] = match;
  return [[Number(processIdText), commandLine]];
};

// A process that started between the two ps runs has no command line and is left out.
const runningProcessOf = (line: string, commandLines: ReadonlyMap<number, string>): ReadonlyArray<RunningProcess> => {
  const match = NAME_LINE.exec(line);
  if (!match) {
    return [];
  }

  const [, processIdText = "", parentProcessIdText = "", nameText = ""] = match;
  const processId = Number(processIdText);
  const commandLine = commandLines.get(processId);
  if (commandLine === undefined) {
    return [];
  }

  return [{ processId, parentProcessId: Number(parentProcessIdText), name: nameText.trim(), commandLine }];
};

export const runningProcesses = (): ReadonlyArray<RunningProcess> => {
  const commandLineEntries = psLines("pid=,command=").flatMap(commandLineEntryOf);
  const commandLines = new Map(commandLineEntries);
  return psLines("pid=,ppid=,ucomm=").flatMap((line) => runningProcessOf(line, commandLines));
};
