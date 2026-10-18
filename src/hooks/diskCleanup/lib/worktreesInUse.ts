import { type FolderPaths, folderPaths, isInsideAnyFolder } from "./folderPaths.js";
import { liveSessions } from "./liveSessions.js";
import { isUsedByRunningProcess, runningProcesses } from "./runningProcesses.js";
import { foldersNamedIn, sessionTranscripts } from "./sessionTranscripts.js";

const foldersHoldingAny = (request: {
  readonly worktrees: ReadonlyArray<FolderPaths>;
  readonly usedFolders: ReadonlyArray<string>;
}): ReadonlyArray<string> =>
  request.worktrees
    .filter((worktree) =>
      request.usedFolders.some((candidate) => isInsideAnyFolder({ candidate, folders: worktree.paths })),
    )
    .map((worktree) => worktree.folder);

// A worktree is in use while a process holds a file in it or names it on its command line, an unfinished background
// job runs there, or a live session's commands, edits, and working folders name it, by any path it goes by. Live
// sessions that cannot all be found, a folder of transcripts that cannot be listed, or a transcript that cannot be read
// could name any worktree.
export const worktreesInUse = (request: {
  readonly homeRoot: string;
  readonly worktreeFolders: ReadonlyArray<string>;
  readonly roots: ReadonlyArray<string>;
  readonly endedSessionId: string;
}): ReadonlySet<string> => {
  if (request.worktreeFolders.length === 0) {
    return new Set();
  }

  const processes = runningProcesses();
  if (!processes) {
    return new Set(request.worktreeFolders);
  }

  const live = liveSessions(request);
  if (!live) {
    return new Set(request.worktreeFolders);
  }

  const transcripts = sessionTranscripts({ ...live, homeRoot: request.homeRoot });
  if (!transcripts) {
    return new Set(request.worktreeFolders);
  }

  const worktrees = request.worktreeFolders.map((folder) => folderPaths({ folder, roots: request.roots }));
  const processFolders = worktrees
    .filter((worktree) => isUsedByRunningProcess({ paths: worktree.paths, processes }))
    .map((worktree) => worktree.folder);
  const jobFolders = foldersHoldingAny({ worktrees, usedFolders: live.jobFolders });
  const sessionFolders = transcripts.flatMap(
    (transcript) =>
      foldersNamedIn({ transcript, folders: worktrees, homeRoot: request.homeRoot }) || request.worktreeFolders,
  );
  return new Set([...processFolders, ...jobFolders, ...sessionFolders]);
};
