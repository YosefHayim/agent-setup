import { spawnSync } from "node:child_process";

const WORKING_FOLDER_LISTING_LIMIT = 64 * 1024 * 1024;
// -d cwd lists only working folders; -n -P -b -w skip name lookups and calls that can hang on a stuck mount.
const WORKING_FOLDER_QUERY = ["-a", "-d", "cwd", "-n", "-P", "-b", "-w", "-Fpn"];
// A hook's PATH can lack /usr/sbin, where macOS keeps lsof.
const LSOF_COMMAND = "/usr/sbin/lsof";

// One block per process, e.g. "130\nfcwd\nn/Users/me/repo": the process id line, then the folder line.
const workingFolderEntryOf = (block: string): ReadonlyArray<readonly [number, string]> => {
  const [processIdLine = "", ...fieldLines] = block.split("\n");
  const folderLine = fieldLines.find((line) => line.startsWith("n"));
  return folderLine === undefined ? [] : [[Number(processIdLine), folderLine.slice(1)]];
};

// lsof exits 1 when one of the listed processes ended meanwhile, so only a failed start or a cut-short listing throws.
export const listWorkingFolders = (processIds: ReadonlyArray<number>): ReadonlyMap<number, string> => {
  const hasNoProcessIds = processIds.length === 0;
  if (hasNoProcessIds) {
    return new Map();
  }

  const listing = spawnSync(LSOF_COMMAND, [...WORKING_FOLDER_QUERY, "-p", processIds.join(",")], {
    encoding: "utf8",
    maxBuffer: WORKING_FOLDER_LISTING_LIMIT,
  });
  if (listing.error) {
    throw listing.error;
  }

  const processBlocks = listing.stdout.split(/^p/mu).filter(Boolean);
  return new Map(processBlocks.flatMap(workingFolderEntryOf));
};
