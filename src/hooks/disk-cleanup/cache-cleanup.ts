import path from "node:path";

import { listOldCodexReleases } from "./codex-releases.js";
import { readFolderPaths } from "./folder-paths.js";
import { isUsedByRunningProcess, type RunningProcesses, readRunningProcesses } from "./running-processes.js";
import { deleteLines, isStale, listChildNames } from "./stale-entries.js";
import { runToolPrunes } from "./tool-prunes.js";
import { listAbandonedXcodeBuildFolders } from "./xcode-build-folders.js";

const isActRunning = (processes: RunningProcesses): boolean =>
  processes.commandLines.some((commandLine) => {
    const program = commandLine.split(" ")[0];
    return path.basename(program) === "act";
  });

// npx keeps each package it ran under ~/.npm/_npx/<hash>; act keeps action clones and its cache server's files.
const listStaleToolCaches = (request: { readonly homeRoot: string; readonly processes: RunningProcesses }) => {
  const npxLines = listChildNames(path.join(request.homeRoot, ".npm", "_npx"));
  const actFolders = [path.join(request.homeRoot, ".cache", "act"), path.join(request.homeRoot, ".cache", "actcache")];
  const actLines = isActRunning(request.processes) ? [] : actFolders.flatMap(listChildNames);
  return [...npxLines, ...actLines].filter(isStale);
};

// Without a process list nothing can be called unused, so only the tools' own prunes run.
const listUnusedCacheLines = (homeRoot: string): ReadonlyArray<string> => {
  const processes = readRunningProcesses();

  const hasNoProcesses = !processes;
  if (hasNoProcesses) {
    return [];
  }

  const candidates = [
    ...listAbandonedXcodeBuildFolders(homeRoot),
    ...listOldCodexReleases(homeRoot),
    ...listStaleToolCaches({ homeRoot, processes }),
  ];
  return candidates.filter((folder) => {
    const { paths } = readFolderPaths({ folder, roots: [] });
    return !isUsedByRunningProcess({ paths, processes });
  });
};

export const cleanUpCaches = (request: { readonly homeRoot: string; readonly dryRun: boolean }) => {
  const unusedLines = listUnusedCacheLines(request.homeRoot);
  const deletionLines = deleteLines({ entries: unusedLines, dryRun: request.dryRun });
  return [...deletionLines, ...runToolPrunes(request)];
};
