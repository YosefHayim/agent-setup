import { codeRootFolders, repoRootsUnder } from "../../lib/codeRepos.js";
import { gitAnswerLines } from "../../lib/gitAnswers.js";
import { type LinkedWorktree, listLinkedWorktrees } from "./linkedWorktrees.js";
import { reportLine } from "./reportLine.js";
import { isInsideFolder } from "./runningProcesses.js";
import { foldersNamedIn, sessionTranscripts } from "./sessionTranscripts.js";
import { decideWorktreeCleanup, type WorktreeCleanupDecision } from "./worktreeCleanupDecision.js";
import { readWorktreeFacts } from "./worktreeFacts.js";
import { removeWorktree } from "./worktreeRemoval.js";
import { worktreesInUse } from "./worktreesInUse.js";

type WorktreeCleanupRequest = {
  readonly homeRoot: string;
  readonly rootFolders: ReadonlyArray<string>;
  readonly endedSessionId: string;
  readonly dryRun: boolean;
};

type RemovalPlan = Extract<WorktreeCleanupDecision, { readonly _tag: "remove" }>;

const pushDetail = (request: { readonly pushVerb: string; readonly push: boolean; readonly branch: string }) => {
  if (!request.push) {
    return "nothing to push";
  }

  return `${request.pushVerb} ${request.branch}`;
};

const applyRemoval = (request: {
  readonly plan: RemovalPlan;
  readonly worktree: LinkedWorktree;
  readonly remote: string;
  readonly dryRun: boolean;
}): string => {
  const { worktree, plan } = request;
  if (request.dryRun) {
    const plannedPush = pushDetail({ pushVerb: "push", push: plan.push, branch: worktree.branch });
    return reportLine({ action: "would remove", detail: plannedPush, target: worktree.folder });
  }

  const removal = removeWorktree({ worktree, remote: request.remote, saveChanges: plan.saveChanges, push: plan.push });
  if (removal._tag === "failed") {
    return reportLine({ action: "kept", detail: `${removal.step} failed`, target: worktree.folder });
  }

  const donePush = pushDetail({ pushVerb: "pushed", push: removal.pushed, branch: worktree.branch });
  return reportLine({ action: "removed", detail: donePush, target: worktree.folder });
};

const cleanUpWorktree = (request: {
  readonly worktree: LinkedWorktree;
  readonly inUse: boolean;
  readonly dryRun: boolean;
}): string => {
  const facts = readWorktreeFacts(request);
  const decision = decideWorktreeCleanup(facts);
  switch (decision._tag) {
    case "keep":
      return reportLine({ action: "kept", detail: decision.reason, target: request.worktree.folder });
    case "remove":
      return applyRemoval({ ...request, plan: decision, remote: facts.remote });
  }
};

// A worktree whose folder is already gone leaves only git's record of it, which prune drops.
const pruneGoneWorktrees = (request: {
  readonly worktrees: ReadonlyArray<LinkedWorktree>;
  readonly dryRun: boolean;
}): ReadonlyArray<string> => {
  const goneWorktrees = request.worktrees.filter((worktree) => worktree.prunable);
  const mainFolders = [...new Set(goneWorktrees.map((worktree) => worktree.mainFolder))];
  const prunedMainFolders = request.dryRun
    ? mainFolders
    : mainFolders.filter((folder) => gitAnswerLines({ folder, query: ["worktree", "prune"] }) !== undefined);
  const action = request.dryRun ? "would prune" : "pruned";
  return goneWorktrees
    .filter((worktree) => prunedMainFolders.includes(worktree.mainFolder))
    .map((worktree) => reportLine({ action, detail: "folder gone", target: worktree.folder }));
};

// A session owns the worktrees its transcripts name: the ones it created or worked in. One whose transcripts cannot be
// read owns none, and a manual pass, which names no session, looks at every worktree.
const worktreesOwnedBy = (request: {
  readonly homeRoot: string;
  readonly endedSessionId: string;
  readonly worktrees: ReadonlyArray<LinkedWorktree>;
}): ReadonlyArray<LinkedWorktree> => {
  if (!request.endedSessionId || request.worktrees.length === 0) {
    return request.worktrees;
  }

  const sessionIds = [request.endedSessionId];
  const transcripts = sessionTranscripts({
    homeRoot: request.homeRoot,
    claudeSessionIds: sessionIds,
    codexThreadIds: sessionIds,
  });
  const worktreeFolders = request.worktrees.map((worktree) => worktree.folder);
  const ownedFolders = transcripts.flatMap(
    (transcript) => foldersNamedIn({ transcript, folders: worktreeFolders, homeRoot: request.homeRoot }) || [],
  );
  return request.worktrees.filter((worktree) => ownedFolders.includes(worktree.folder));
};

// Only worktrees under the code roots are touched; ones in scratch, job, or agent folders belong to whoever made them.
export const cleanUpWorktrees = (request: WorktreeCleanupRequest): ReadonlyArray<string> => {
  const roots = codeRootFolders(request);
  const repoRoots = repoRootsUnder(roots);
  const worktrees = listLinkedWorktrees(repoRoots).filter((worktree) =>
    roots.some((folder) => isInsideFolder({ candidate: worktree.folder, folder })),
  );
  const presentWorktrees = worktrees.filter((worktree) => !worktree.prunable);
  const ownedWorktrees = worktreesOwnedBy({ ...request, worktrees: presentWorktrees });
  const worktreeFolders = ownedWorktrees.map((worktree) => worktree.folder);
  const usedFolders = worktreesInUse({ ...request, worktreeFolders });
  const worktreeLines = ownedWorktrees.map((worktree) =>
    cleanUpWorktree({ worktree, inUse: usedFolders.has(worktree.folder), dryRun: request.dryRun }),
  );
  return [...worktreeLines, ...pruneGoneWorktrees({ worktrees, dryRun: request.dryRun })];
};
