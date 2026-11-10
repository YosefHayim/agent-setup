import { readlinkSync } from "node:fs";
import path from "node:path";

import { codexHome } from "../codex-home.js";
import { childEntries, isStale } from "./stale-entries.js";

const currentReleaseName = (packageFolder: string): string => {
  try {
    return path.basename(readlinkSync(path.join(packageFolder, "current")));
  } catch {
    return "";
  }
};

// <codex home>/packages/<package>/current links to releases/<version>-<target>; a status-line build of the same
// version is named <version>-statusline-<hash>-<target>.
const oldReleasesOf = (packageFolder: string): ReadonlyArray<string> => {
  const currentName = currentReleaseName(packageFolder);
  if (!currentName) {
    return [];
  }

  const currentVersion = currentName.split("-")[0];
  return childEntries(path.join(packageFolder, "releases")).filter((release) => {
    const releaseName = path.basename(release);
    return releaseName !== currentName && !releaseName.startsWith(`${currentVersion}-`) && isStale(release);
  });
};

export const oldCodexReleases = (homeRoot: string): ReadonlyArray<string> => {
  const packagesFolder = path.join(codexHome(homeRoot), "packages");
  return childEntries(packagesFolder).flatMap(oldReleasesOf);
};
