import { liveSessions } from "./liveSessions.js";
import { isInsideFolder, isUsedByRunningProcess, runningProcesses } from "./runningProcesses.js";
import { foldersNamedIn, sessionTranscripts } from "./sessionTranscripts.js";

const foldersHoldingAny = (request: {
  readonly worktreeFolders: ReadonlyArray<string>;
  readonly usedFolders: ReadonlyArray<string>;
}): ReadonlyArray<string> =>
  request.worktreeFolders.filter((folder) =>
    request.usedFolders.some((candidate) => isInsideFolder({ candidate, folder })),
  );

// A worktree is in use while a process holds a file in it or names it on its command line, an unfinished background
// job runs there, or a live session's commands, edits, and working folders name it. Live sessions that cannot all be
// found, a folder of transcripts that cannot be listed, or a transcript that cannot be read could name any worktree.
export const worktreesInUse = (request: {
  readonly homeRoot: string;
  readonly worktreeFolders: ReadonlyArray<string>;
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

  const processFolders = request.worktreeFolders.filter((folder) => isUsedByRunningProcess({ folder, processes }));
  const jobFolders = foldersHoldingAny({ worktreeFolders: request.worktreeFolders, usedFolders: live.jobFolders });
  const sessionFolders = transcripts.flatMap(
    (transcript) =>
      foldersNamedIn({ transcript, folders: request.worktreeFolders, homeRoot: request.homeRoot }) ||
      request.worktreeFolders,
  );
  return new Set([...processFolders, ...jobFolders, ...sessionFolders]);
};
