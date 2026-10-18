import { lstatSync, readdirSync } from "node:fs";

// Only a path with nothing at its end names no folder. A file, or a link to nowhere, in the folder's place leaves its
// entries unknown.
const isMissingFolder = (folder: string): boolean => {
  try {
    lstatSync(folder);
    return false;
  } catch (failure) {
    const code = failure instanceof Error && "code" in failure ? failure.code : "";
    return code === "ENOENT" || code === "ENOTDIR";
  }
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
