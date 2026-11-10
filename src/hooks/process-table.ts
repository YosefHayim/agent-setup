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
const PS_PRINTOUT_LIMIT = 64 * 1024 * 1024;

// A failed or cut-short listing throws, so the hook fails open instead of judging part of the table.
const listPsLines = (columns: string): ReadonlyArray<string> => {
  const listing = spawnSync("ps", ["-A", "-ww", "-o", columns], { encoding: "utf8", maxBuffer: PS_PRINTOUT_LIMIT });

  const hasListingError = listing.error;
  if (hasListingError) {
    throw listing.error;
  }

  return listing.stdout.split("\n");
};

// ps prints the time a process has run as [[days-]hours:]minutes:seconds; a text in another shape counts as 0.
export const readElapsedSeconds = (elapsedString: string): number => {
  const parts = ELAPSED_TIME.exec(elapsedString);

  const hasNoParts = !parts;
  if (hasNoParts) {
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

interface CommandLine {
  readonly commandLine: string;
  readonly elapsedSeconds: number;
}

const listCommandLine = (line: string): ReadonlyArray<readonly [number, CommandLine]> => {
  const hit = COMMAND_LINE.exec(line);
  const isHitMissing = hit == null;
  if (isHitMissing) {
    return [];
  }

  const [, processIdString = "", elapsedString = "", commandLine = ""] = hit;
  return [[Number(processIdString), { commandLine, elapsedSeconds: readElapsedSeconds(elapsedString) }]];
};

// A process that started between the two ps runs has no command line and is left out.
const listRunningProcess = (
  line: string,
  commandLines: ReadonlyMap<number, CommandLine>,
): ReadonlyArray<RunningProcess> => {
  const hit = NAME_LINE.exec(line);

  const hasNoHit = !hit;
  if (hasNoHit) {
    return [];
  }

  const [, processIdString = "", parentProcessIdString = "", nameString = ""] = hit;
  const processId = Number(processIdString);

  const commandLine = commandLines.get(processId);

  const isCommandLineMissing = commandLine == null;
  if (isCommandLineMissing) {
    return [];
  }

  return [{ processId, parentProcessId: Number(parentProcessIdString), name: nameString.trim(), ...commandLine }];
};

export const listRunningProcesses = (): ReadonlyArray<RunningProcess> => {
  const commandLineLines = listPsLines("pid=,etime=,command=").flatMap(listCommandLine);
  const commandLines = new Map(commandLineLines);
  return listPsLines("pid=,ppid=,ucomm=").flatMap((line) => listRunningProcess(line, commandLines));
};
