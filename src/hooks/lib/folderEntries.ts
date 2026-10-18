import { readdirSync } from "node:fs";

const isMissingFolder = (failure: unknown): boolean =>
  failure instanceof Error && "code" in failure && (failure.code === "ENOENT" || failure.code === "ENOTDIR");

// A folder that is not there has no entries. One that is there but cannot be listed throws, since its entries are
// unknown.
export const folderEntries = (request: {
  readonly folder: string;
  readonly recursive: boolean;
}): ReadonlyArray<string> => {
  try {
    return readdirSync(request.folder, { recursive: request.recursive, encoding: "utf8" });
  } catch (failure) {
    if (isMissingFolder(failure)) {
      return [];
    }

    throw failure;
  }
};
