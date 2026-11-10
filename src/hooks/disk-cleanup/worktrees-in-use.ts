import { type FolderPaths, isInsideAnyFolder, readFolderPaths } from "./folder-paths.js";
import { readLiveSessions } from "./live-sessions.js";
import { isUsedByRunningProcess, readRunningProcesses } from "./running-processes.js";
import { readFoldersNamedIn, readSessionTranscripts } from "./session-transcripts.js";

const listFoldersHoldingAny = (request: {
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
export const readWorktreesInUse = (request: {
  readonly homeRoot: string;
  readonly worktreeFolders: ReadonlyArray<string>;
  readonly roots: ReadonlyArray<string>;
  readonly endedSessionId: string;
}): ReadonlySet<string> => {
  const isRequestWorktreeFoldersEmpty = request.worktreeFolders.length === 0;
  if (isRequestWorktreeFoldersEmpty) {
    return new Set();
  }

  const processes = readRunningProcesses();

  const hasNoProcesses = !processes;
  if (hasNoProcesses) {
    return new Set(request.worktreeFolders);
  }

  const live = readLiveSessions(request);

  const isNotLive = !live;
  if (isNotLive) {
    return new Set(request.worktreeFolders);
  }

  const transcripts = readSessionTranscripts({ ...live, homeRoot: request.homeRoot });

  const hasNoTranscripts = !transcripts;
  if (hasNoTranscripts) {
    return new Set(request.worktreeFolders);
  }

  const worktrees = request.worktreeFolders.map((folder) => readFolderPaths({ folder, roots: request.roots }));
  const processFolders = worktrees
    .filter((worktree) => isUsedByRunningProcess({ paths: worktree.paths, processes }))
    .map((worktree) => worktree.folder);
  const jobFolders = listFoldersHoldingAny({ worktrees, usedFolders: live.jobFolders });
  const sessionFolders = transcripts.flatMap(
    (transcript) =>
      readFoldersNamedIn({ transcript, folders: worktrees, homeRoot: request.homeRoot }) || request.worktreeFolders,
  );
  return new Set([...processFolders, ...jobFolders, ...sessionFolders]);
};
