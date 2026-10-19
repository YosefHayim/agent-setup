import { existsSync } from "node:fs";

import { codeRootFolders, repoRootsUnder } from "../../lib/codeRepos.js";
import { gitSucceeds } from "../../lib/gitAnswers.js";
import { folderPaths, isInsideAnyFolder } from "./folderPaths.js";
import { readKeptWorktrees, saveKeptWorktrees } from "./keptWorktrees.js";
import { type LinkedWorktree, listLinkedWorktrees } from "./linkedWorktrees.js";
import { reportLine } from "./reportLine.js";
import { foldersOwnedBy } from "./sessionTranscripts.js";
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
    : mainFolders.filter((folder) => gitSucceeds({ folder, query: ["worktree", "prune"] }));
  const action = request.dryRun ? "would prune" : "pruned";
  return goneWorktrees
    .filter((worktree) => prunedMainFolders.includes(worktree.mainFolder))
    .map((worktree) => reportLine({ action, detail: "folder gone", target: worktree.folder }));
};

// Whatever is still there was kept, and the next session's end looks at it again.
const rememberKeptWorktrees = (request: {
  readonly worktreeFolders: ReadonlyArray<string>;
  readonly dryRun: boolean;
}): void => {
  if (request.dryRun) {
    return;
  }

  const keptFolders = request.worktreeFolders.filter(existsSync);
  saveKeptWorktrees(keptFolders);
};

// Only worktrees under the code roots, by either path a root goes by, are touched; ones in scratch, job, or agent
// folders belong to whoever made them. Besides the ended session's own worktrees, each pass looks again at the ones an
// earlier pass kept.
export const cleanUpWorktrees = (request: WorktreeCleanupRequest): ReadonlyArray<string> => {
  const roots = codeRootFolders(request);
  const repoRoots = repoRootsUnder(roots);
  const rootPaths = roots.flatMap((root) => folderPaths({ folder: root, roots: [] }).paths);
  const worktrees = listLinkedWorktrees(repoRoots).filter((worktree) =>
    isInsideAnyFolder({ candidate: worktree.folder, folders: rootPaths }),
  );
  const presentWorktrees = worktrees.filter((worktree) => !worktree.prunable);
  const presentFolders = presentWorktrees.map((worktree) => worktree.folder);
  const sessionFolders = foldersOwnedBy({ ...request, folders: presentFolders, roots });
  const keptFolders = readKeptWorktrees();
  const ownedWorktrees = presentWorktrees.filter(
    (worktree) => sessionFolders.includes(worktree.folder) || keptFolders.includes(worktree.folder),
  );
  const worktreeFolders = ownedWorktrees.map((worktree) => worktree.folder);
  const usedFolders = worktreesInUse({ ...request, worktreeFolders, roots });
  const worktreeLines = ownedWorktrees.map((worktree) =>
    cleanUpWorktree({ worktree, inUse: usedFolders.has(worktree.folder), dryRun: request.dryRun }),
  );
  rememberKeptWorktrees({ worktreeFolders, dryRun: request.dryRun });
  return [...worktreeLines, ...pruneGoneWorktrees({ worktrees, dryRun: request.dryRun })];
};
