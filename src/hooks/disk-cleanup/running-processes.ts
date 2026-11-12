import { spawnSync } from "node:child_process";

import { isInsideAnyFolder } from "./folder-paths.js";

export type RunningProcesses = {
  readonly openPaths: ReadonlyArray<string>;
  readonly commandLines: ReadonlyArray<string>;
};

const PROCESS_LIST_BYTES = 64 * 1024 * 1024;
// -n and -P skip name lookups for network files and -b skips calls that can hang on a stuck mount, which together
// bring the full list down from seconds to a fraction of one; -w drops the warnings -b prints.
const OPEN_FILE_QUERY = ["-n", "-P", "-b", "-w", "-Fn"];

// A hook's PATH can lack /usr/sbin, where macOS keeps lsof, and the Homebrew folders, where gh lives.
export const readSystemToolCall = (request: {
  readonly tool: string;
  readonly toolArguments: ReadonlyArray<string>;
  readonly workingFolder?: string;
  readonly timeoutMilliseconds?: number;
}) =>
  spawnSync(request.tool, request.toolArguments, {
    encoding: "utf8",
    cwd: request.workingFolder,
    timeout: request.timeoutMilliseconds,
    env: { ...process.env, PATH: `${process.env.PATH || ""}:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/usr/bin:/bin` },
    maxBuffer: PROCESS_LIST_BYTES,
  });

// lsof -Fn prints every file each process holds, working folders included, as "n<path>". A listing that failed or
// was cut short could miss one, so it is no answer at all.
export const listOpenPaths = (): ReadonlyArray<string> | null => {
  const lsof = readSystemToolCall({ tool: "lsof", toolArguments: OPEN_FILE_QUERY });

  const hasLsofFailed = lsof.error || lsof.status !== 0;
  if (hasLsofFailed) {
    return null;
  }

  return lsof.stdout
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
};

// Without lsof or ps nothing can be ruled out, so the caller treats every folder as in use.
export const readRunningProcesses = (): RunningProcesses | null => {
  const openPaths = listOpenPaths();

  const ps = readSystemToolCall({ tool: "ps", toolArguments: ["-axo", "command="] });

  const isListingFailed = !openPaths || ps.error || ps.status !== 0;
  if (isListingFailed) {
    return null;
  }

  return { openPaths, commandLines: ps.stdout.split("\n").filter(Boolean) };
};

// The paths are every path one folder goes by.
export const isUsedByRunningProcess = (request: {
  readonly paths: ReadonlyArray<string>;
  readonly processes: RunningProcesses;
}): boolean => {
  const isOpenThere = request.processes.openPaths.some((candidate) =>
    isInsideAnyFolder({ candidate, folders: request.paths }),
  );
  const isRunningFromThere = request.processes.commandLines.some((commandLine) =>
    request.paths.some((folderPath) => commandLine.includes(folderPath)),
  );
  return isOpenThere || isRunningFromThere;
};
