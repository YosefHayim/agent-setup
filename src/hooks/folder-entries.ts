import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";

const isThere = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch (failure) {
    const hasErrorCode = failure instanceof Error && "code" in failure;
    const code = hasErrorCode ? failure.code : "";

    const isMissingPathCode = code === "ENOENT" || code === "ENOTDIR";
    if (isMissingPathCode) {
      return false;
    }

    throw failure;
  }
};

const readNearestPath = (folderPath: string): string =>
  isThere(folderPath) ? folderPath : readNearestPath(path.dirname(folderPath));

// The nearest part of the folder's path that is there decides. A folder or a file there leaves nothing to list, while
// anything in the folder's own place, or a link to nowhere, leaves its entries unknown.
const isMissingFolder = (folder: string): boolean => {
  const nearest = readNearestPath(folder);
  return nearest !== folder && existsSync(nearest);
};

// A folder that is not there, or whose path runs through a file, has no entries. Anything else that cannot be listed
// throws, since its entries are unknown.
export const listFolderNames = (request: {
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
