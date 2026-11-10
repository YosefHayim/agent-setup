import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const isGitCheckout = (folder: string): boolean => existsSync(path.join(folder, ".git"));

const listVisibleChildFolders = (folder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((line) => line.isDirectory() && !line.name.startsWith("."))
      .map((child) => path.join(folder, child.name));
  } catch {
    return [];
  }
};

// Repos sit directly in a root (~/Desktop/Code/vybekiit) or one grouping folder down (~/Desktop/Code/genshot-org/cli).
const listReposUnder = (root: string): ReadonlyArray<string> =>
  listVisibleChildFolders(root).flatMap((child) =>
    isGitCheckout(child) ? [child] : listVisibleChildFolders(child).filter(isGitCheckout),
  );

// Root folders are set relative to home, e.g. "Desktop/Code".
export const listCodeRootFolders = (request: {
  readonly homeRoot: string;
  readonly rootFolders: ReadonlyArray<string>;
}): ReadonlyArray<string> => [...new Set(request.rootFolders.map((folder) => path.resolve(request.homeRoot, folder)))];

export const listRepoRootsUnder = (roots: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set(roots.flatMap(listReposUnder)),
];
