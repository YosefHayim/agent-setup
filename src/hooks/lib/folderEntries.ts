import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";

const isThere = (entry: string): boolean => {
  try {
    lstatSync(entry);
    return true;
  } catch (failure) {
    const code = failure instanceof Error && "code" in failure ? failure.code : "";
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }

    throw failure;
  }
};

const nearestEntry = (entry: string): string => (isThere(entry) ? entry : nearestEntry(path.dirname(entry)));

// The nearest part of the folder's path that is there decides. A folder or a file there leaves nothing to list, while
// anything in the folder's own place, or a link to nowhere, leaves its entries unknown.
const isMissingFolder = (folder: string): boolean => {
  const nearest = nearestEntry(folder);
  return nearest !== folder && existsSync(nearest);
};

// A folder that is not there, or whose path runs through a file, has no entries. Anything else that cannot be listed
// throws, since its entries are unknown.
export const folderEntries = (request: {
  readonly folder: string;
  readonly recursive: boolean;
}): ReadonlyArray<string> => {
  try {
    return readdirSync(request.folder, { recursive: request.recursive, encoding: "utf8" });
  } catch (failure) {
    if (isMissingFolder(request.folder)) {
      return [];
    }

    throw failure;
  }
};
