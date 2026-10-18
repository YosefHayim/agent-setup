import path from "node:path";

import { oldCodexReleases } from "./codexReleases.js";
import { folderPaths } from "./folderPaths.js";
import { isUsedByRunningProcess, type RunningProcesses, runningProcesses } from "./runningProcesses.js";
import { childEntries, deleteEntries, isStale } from "./staleEntries.js";
import { runToolPrunes } from "./toolPrunes.js";
import { abandonedXcodeBuildFolders } from "./xcodeBuildFolders.js";

const isActRunning = (processes: RunningProcesses): boolean =>
  processes.commandLines.some((commandLine) => {
    const program = commandLine.split(" ")[0];
    return path.basename(program) === "act";
  });

// npx keeps each package it ran under ~/.npm/_npx/<hash>; act keeps action clones and its cache server's files.
const staleToolCaches = (request: { readonly homeRoot: string; readonly processes: RunningProcesses }) => {
  const npxEntries = childEntries(path.join(request.homeRoot, ".npm", "_npx"));
  const actFolders = [path.join(request.homeRoot, ".cache", "act"), path.join(request.homeRoot, ".cache", "actcache")];
  const actEntries = isActRunning(request.processes) ? [] : actFolders.flatMap(childEntries);
  return [...npxEntries, ...actEntries].filter(isStale);
};

// Without a process list nothing can be called unused, so only the tools' own prunes run.
const unusedCacheEntries = (homeRoot: string): ReadonlyArray<string> => {
  const processes = runningProcesses();
  if (!processes) {
    return [];
  }

  const candidates = [
    ...abandonedXcodeBuildFolders(homeRoot),
    ...oldCodexReleases(homeRoot),
    ...staleToolCaches({ homeRoot, processes }),
  ];
  return candidates.filter((folder) => {
    const { paths } = folderPaths({ folder, roots: [] });
    return !isUsedByRunningProcess({ paths, processes });
  });
};

export const cleanUpCaches = (request: { readonly homeRoot: string; readonly dryRun: boolean }) => {
  const unusedEntries = unusedCacheEntries(request.homeRoot);
  const deletionLines = deleteEntries({ entries: unusedEntries, dryRun: request.dryRun });
  return [...deletionLines, ...runToolPrunes(request)];
};
