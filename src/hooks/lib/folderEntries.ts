import { existsSync, readdirSync } from "node:fs";

// A path that runs through a file names no folder, while a file in the folder's own place leaves its entries unknown.
const isMissingFolder = (request: { readonly folder: string; readonly failure: unknown }): boolean => {
  const code = request.failure instanceof Error && "code" in request.failure ? request.failure.code : "";
  return code === "ENOENT" || (code === "ENOTDIR" && !existsSync(request.folder));
};

// A folder that is not there has no entries. A file in its place, or a folder that cannot be listed, throws, since its
// entries are unknown.
export const folderEntries = (request: {
  readonly folder: string;
  readonly recursive: boolean;
}): ReadonlyArray<string> => {
  try {
    return readdirSync(request.folder, { recursive: request.recursive, encoding: "utf8" });
  } catch (failure) {
    if (isMissingFolder({ folder: request.folder, failure })) {
      return [];
    }

    throw failure;
  }
};
