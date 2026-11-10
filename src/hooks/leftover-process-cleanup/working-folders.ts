import { spawnSync } from "node:child_process";
import { readlinkSync } from "node:fs";

const WORKING_FOLDER_LISTING_LIMIT = 64 * 1024 * 1024;
// -d cwd lists only working folders; -n -P -b -w skip name lookups and calls that can hang on a stuck mount.
const WORKING_FOLDER_QUERY = ["-a", "-d", "cwd", "-n", "-P", "-b", "-w", "-Fpn"];
// A hook's PATH can lack /usr/sbin, where macOS keeps lsof.
const LSOF_COMMAND = "/usr/sbin/lsof";
// Linux has no lsof at that path on most machines, and keeps each working folder as a link under /proc instead.
const isLinux = process.platform === "linux";
// The kernel adds this suffix to a /proc link whose folder was deleted; the folder path comes before it.
const DELETED_FOLDER_SUFFIX = " (deleted)";

// One block per process, e.g. "130\nfcwd\nn/Users/me/repo": the process id line, then the folder line.
const listWorkingFolderLine = (block: string): ReadonlyArray<readonly [number, string]> => {
  const [processIdLine = "", ...fieldLines] = block.split("\n");
  const folderLine = fieldLines.find((line) => line.startsWith("n"));

  const isFolderLineMissing = folderLine == null;
  return isFolderLineMissing ? [] : [[Number(processIdLine), folderLine.slice(1)]];
};

const readLsofWorkingFolders = (processIds: ReadonlyArray<number>): ReadonlyArray<readonly [number, string]> => {
  const listing = spawnSync(LSOF_COMMAND, [...WORKING_FOLDER_QUERY, "-p", processIds.join(",")], {
    encoding: "utf8",
    maxBuffer: WORKING_FOLDER_LISTING_LIMIT,
  });

  const hasListingError = listing.error;
  if (hasListingError) {
    throw listing.error;
  }

  const processBlocks = listing.stdout.split(/^p/mu).filter(Boolean);
  return processBlocks.flatMap(listWorkingFolderLine);
};

// A process that ended, or belongs to another user, has no readable link; lsof leaves it out the same way.
const readProcWorkingFolderLine = (processId: number): ReadonlyArray<readonly [number, string]> => {
  const folderLinkPath = `/proc/${processId}/cwd`;
  try {
    const linkedFolder = readlinkSync(folderLinkPath);
    const isFolderDeleted = linkedFolder.endsWith(DELETED_FOLDER_SUFFIX);
    const folder = isFolderDeleted ? linkedFolder.slice(0, -DELETED_FOLDER_SUFFIX.length) : linkedFolder;
    return [[processId, folder]];
  } catch (failure) {
    const isNotLinkUnreadable =
      !(failure instanceof Error) || !("code" in failure) || (failure.code !== "ENOENT" && failure.code !== "EACCES");
    if (isNotLinkUnreadable) {
      throw failure;
    }

    return [];
  }
};

const readWorkingFolderLines = (processIds: ReadonlyArray<number>): ReadonlyArray<readonly [number, string]> => {
  if (isLinux) {
    return processIds.flatMap(readProcWorkingFolderLine);
  }

  return readLsofWorkingFolders(processIds);
};

// lsof exits 1 when one of the listed processes ended meanwhile, so only a failed start or a cut-short listing throws.
export const listWorkingFolders = (processIds: ReadonlyArray<number>): ReadonlyMap<number, string> => {
  const hasNoProcessIds = processIds.length === 0;
  if (hasNoProcessIds) {
    return new Map();
  }

  return new Map(readWorkingFolderLines(processIds));
};
