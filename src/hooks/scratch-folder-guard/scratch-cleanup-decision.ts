export type StopCheck = {
  // The turn is already running because a Stop hook spoke, so asking again would loop.
  readonly alreadyContinuing: boolean;
  // A background task is in flight or a wakeup is scheduled: the session is paused, not finished.
  readonly workPending: boolean;
  // Only a session with a person at it is asked; a headless run prints its last message as its answer.
  readonly attended: boolean;
  readonly scratchFoldersWithFiles: ReadonlyArray<string>;
  readonly cleanupCommand: string;
};

export type ScratchCleanupDecision = { readonly _tag: "quiet" } | { readonly _tag: "ask"; readonly question: string };

const cleanupQuestion = (check: StopCheck): string =>
  [
    "Scratch cleanup check. This session left files in its scratch folder:",
    ...check.scratchFoldersWithFiles.map((folder) => `- ${folder}`),
    "",
    "If everything the user asked for is finished:",
    `1. Run: ${check.cleanupCommand}`,
    "   It deletes the files in that folder. A git clone or worktree there with work that is not committed and pushed is kept and named.",
    "2. Delete any other throwaway file you made or used in this session, in the repo or elsewhere: logs, one-off scripts, test output.",
    "Never delete work: files that belong to a repo, or that the user asked for. Move a file the user needs out of the scratch folder first.",
    "If work is still open, or you are not sure a file is throwaway, keep it.",
    "Then end your turn with one short line. Do not repeat your last message.",
  ].join("\n");

export const decideScratchCleanup = (check: StopCheck): ScratchCleanupDecision => {
  const turnMayEnd = check.alreadyContinuing || check.workPending || !check.attended;
  if (turnMayEnd || check.scratchFoldersWithFiles.length === 0) {
    return { _tag: "quiet" };
  }

  return { _tag: "ask", question: cleanupQuestion(check) };
};
