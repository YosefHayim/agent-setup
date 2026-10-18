import { spawnSync } from "node:child_process";

import { folderPaths } from "./folderPaths.js";

export type RunningProcesses = {
  readonly openPaths: ReadonlyArray<string>;
  readonly commandLines: ReadonlyArray<string>;
};

const PROCESS_LIST_BYTES = 64 * 1024 * 1024;
// -n and -P skip name lookups for network files and -b skips calls that can hang on a stuck mount, which together
// bring the full list down from seconds to a fraction of one; -w drops the warnings -b prints.
const OPEN_FILE_QUERY = ["-n", "-P", "-b", "-w", "-Fn"];

// A hook's PATH can lack /usr/sbin, where macOS keeps lsof.
const systemToolCall = (request: { readonly tool: string; readonly toolArguments: ReadonlyArray<string> }) =>
  spawnSync(request.tool, request.toolArguments, {
    encoding: "utf8",
    env: { ...process.env, PATH: `${process.env.PATH || ""}:/usr/sbin:/usr/bin:/bin` },
    maxBuffer: PROCESS_LIST_BYTES,
  });

// lsof -Fn prints every file each process holds, working folders included, as "n<path>". A listing that failed or
// was cut short could miss one, so it is no answer at all.
export const listOpenPaths = (): ReadonlyArray<string> | undefined => {
  const lsof = systemToolCall({ tool: "lsof", toolArguments: OPEN_FILE_QUERY });
  if (lsof.error || lsof.status !== 0) {
    return undefined;
  }

  return lsof.stdout
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
};

// Without lsof or ps nothing can be ruled out, so the caller treats every folder as in use.
export const runningProcesses = (): RunningProcesses | undefined => {
  const openPaths = listOpenPaths();
  const ps = systemToolCall({ tool: "ps", toolArguments: ["-axo", "command="] });
  if (!openPaths || ps.error || ps.status !== 0) {
    return undefined;
  }

  return { openPaths, commandLines: ps.stdout.split("\n").filter(Boolean) };
};

export const isInsideAnyFolder = (request: {
  readonly candidate: string;
  readonly folders: ReadonlyArray<string>;
}): boolean =>
  request.folders.some((folder) => request.candidate === folder || request.candidate.startsWith(`${folder}/`));

export const isUsedByRunningProcess = (request: {
  readonly folder: string;
  readonly processes: RunningProcesses;
}): boolean => {
  const paths = folderPaths(request.folder);
  const isOpenThere = request.processes.openPaths.some((candidate) => isInsideAnyFolder({ candidate, folders: paths }));
  const isRunningFromThere = request.processes.commandLines.some((commandLine) =>
    paths.some((folderPath) => commandLine.includes(folderPath)),
  );
  return isOpenThere || isRunningFromThere;
};
