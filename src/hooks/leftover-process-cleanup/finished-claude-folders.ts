import { statSync } from "node:fs";
import path from "node:path";

import { listFinishedClaudeJobTmpFolders, listUnfinishedClaudeJobStatuses } from "../claude-jobs.js";
import { readLiveClaudeSessionIds } from "../claude-live-sessions.js";
import { listClaudeScratchRoots } from "../claude-scratch-roots.js";
import { listFolderNames } from "../folder-entries.js";

// The scratch root also holds plain files (caches); only the folders are projects and sessions.
const listSubfolderNames = (folder: string): ReadonlyArray<string> =>
  listFolderNames({ folder, recursive: false }).filter(
    (name) => statSync(path.join(folder, name), { throwIfNoEntry: false })?.isDirectory() === true,
  );

// Scratch folders sit at <scratch root>/<project>/<session>. A session that is not running and belongs to no unfinished
// job will not come back to use its folder.
const listDeadSessionScratchFolders = (homeRoot: string): ReadonlyArray<string> => {
  const liveSessionIds = readLiveClaudeSessionIds(homeRoot);
  const unfinishedSessionIds = listUnfinishedClaudeJobStatuses(homeRoot).map((jobStatus) => jobStatus.sessionId);

  return listClaudeScratchRoots(homeRoot).flatMap((scratchRoot) =>
    listSubfolderNames(scratchRoot).flatMap((projectName) => {
      const projectFolder = path.join(scratchRoot, projectName);
      return listSubfolderNames(projectFolder)
        .filter((sessionId) => !liveSessionIds.has(sessionId) && !unfinishedSessionIds.includes(sessionId))
        .map((sessionId) => path.join(projectFolder, sessionId));
    }),
  );
};

export const listFinishedClaudeFolders = (homeRoot: string): ReadonlyArray<string> => [
  ...listFinishedClaudeJobTmpFolders(homeRoot),
  ...listDeadSessionScratchFolders(homeRoot),
];
