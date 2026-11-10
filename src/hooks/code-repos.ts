import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const isGitCheckout = (folder: string): boolean => existsSync(path.join(folder, ".git"));

const visibleChildFolders = (folder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(folder, entry.name));
  } catch {
    return [];
  }
};

// Repos sit directly in a root (~/Desktop/Code/vybekiit) or one grouping folder down (~/Desktop/Code/genshot-org/cli).
const reposUnder = (root: string): ReadonlyArray<string> =>
  visibleChildFolders(root).flatMap((child) =>
    isGitCheckout(child) ? [child] : visibleChildFolders(child).filter(isGitCheckout),
  );

// Root folders are set relative to home, e.g. "Desktop/Code".
export const codeRootFolders = (request: {
  readonly homeRoot: string;
  readonly rootFolders: ReadonlyArray<string>;
}): ReadonlyArray<string> => [...new Set(request.rootFolders.map((folder) => path.resolve(request.homeRoot, folder)))];

export const repoRootsUnder = (roots: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set(roots.flatMap(reposUnder)),
];
