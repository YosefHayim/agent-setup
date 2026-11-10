import { readlinkSync } from "node:fs";
import path from "node:path";

import { readCodexHome } from "../codex-home.js";
import { isStale, listChildNames } from "./stale-entries.js";

const readCurrentReleaseName = (packageFolder: string): string => {
  try {
    return path.basename(readlinkSync(path.join(packageFolder, "current")));
  } catch {
    return "";
  }
};

// <codex home>/packages/<package>/current links to releases/<version>-<target>; a status-line build of the same
// version is named <version>-statusline-<hash>-<target>.
const listOldReleases = (packageFolder: string): ReadonlyArray<string> => {
  const currentName = readCurrentReleaseName(packageFolder);

  const hasNoCurrentName = !currentName;
  if (hasNoCurrentName) {
    return [];
  }

  const currentVersion = currentName.split("-")[0];
  return listChildNames(path.join(packageFolder, "releases")).filter((release) => {
    const releaseName = path.basename(release);
    return releaseName !== currentName && !releaseName.startsWith(`${currentVersion}-`) && isStale(release);
  });
};

export const listOldCodexReleases = (homeRoot: string): ReadonlyArray<string> => {
  const packagesFolder = path.join(readCodexHome(homeRoot), "packages");
  return listChildNames(packagesFolder).flatMap(listOldReleases);
};
