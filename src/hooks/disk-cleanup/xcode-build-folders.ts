import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { isStale, listChildNames } from "./stale-entries.js";

// Each project's build folder records where the project was opened from, e.g.
// <key>WorkspacePath</key><string>/Users/me/Code/Tom &amp; Jerry/ios/App.xcworkspace</string>
const WORKSPACE_PATH_PATTERN = /<key>WorkspacePath<\/key>\s*<string>([^<]*)<\/string>/u;
const XML_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos);/gu;
const XML_ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&apos;", "'"],
]);

const decodeXmlString = (encodedString: string): string =>
  encodedString.replace(XML_ENTITY_PATTERN, (entity) => XML_ENTITIES.get(entity) || entity);

// An info.plist that is missing or cannot be read gives no path at all, and one without a WorkspacePath an empty one.
const readWorkspacePathIn = (workspacePlist: string): string | undefined => {
  try {
    const plistString = readFileSync(workspacePlist, "utf8");
    const encodedPath = WORKSPACE_PATH_PATTERN.exec(plistString)?.[1] || "";
    return decodeXmlString(encodedPath);
  } catch {
    return undefined;
  }
};

const isAbandoned = (buildFolder: string): boolean => {
  const workspacePlist = path.join(buildFolder, "info.plist");
  const workspacePath = readWorkspacePathIn(workspacePlist);

  const isWorkspacePathMissing = workspacePath == null;
  if (isWorkspacePathMissing) {
    return false;
  }

  const isProjectGone = workspacePath !== "" && !existsSync(workspacePath);
  return isProjectGone || isStale(workspacePlist);
};

// Xcode rebuilds a project's folder on the next build; one whose project is gone or unopened for weeks is only weight.
// Shared folders such as ModuleCache.noindex have no info.plist and stay.
export const listAbandonedXcodeBuildFolders = (homeRoot: string): ReadonlyArray<string> => {
  const buildFoldersRoot = path.join(homeRoot, "Library", "Developer", "Xcode", "DerivedData");
  return listChildNames(buildFoldersRoot).filter(isAbandoned);
};
