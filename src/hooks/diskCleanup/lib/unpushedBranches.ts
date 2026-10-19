import { codeRootFolders, repoRootsUnder } from "../../lib/codeRepos.js";
import { gitAnswerLines } from "../../lib/gitAnswers.js";
import { readBranchFacts } from "./branchFacts.js";
import { pushBranch } from "./branchPush.js";
import { decideBranchPush } from "./branchPushDecision.js";
import { realFolder } from "./folderPaths.js";
import { reportLine } from "./reportLine.js";
import { foldersOwnedBy } from "./sessionTranscripts.js";
import { worktreesInUse } from "./worktreesInUse.js";

type BranchCleanupRequest = {
  readonly homeRoot: string;
  readonly rootFolders: ReadonlyArray<string>;
  readonly endedSessionId: string;
  readonly dryRun: boolean;
};

// The checkout folder is "" for a branch no work tree has checked out.
type LocalBranch = { readonly repoFolder: string; readonly branch: string; readonly checkoutFolder: string };

// e.g. "login\t/Users/me/Code/app/.worktrees/login"
const LOCAL_BRANCH_QUERY = ["for-each-ref", "--format=%(refname:lstrip=2)%09%(worktreepath)", "refs/heads/"];

const localBranchesOf = (repoFolder: string): ReadonlyArray<LocalBranch> => {
  const branchLines = gitAnswerLines({ folder: repoFolder, query: LOCAL_BRANCH_QUERY }) || [];
  return branchLines.map((line) => {
    const tabAt = line.indexOf("\t");
    return { repoFolder, branch: line.slice(0, tabAt), checkoutFolder: line.slice(tabAt + 1) };
  });
};

const isCheckedOut = (branch: LocalBranch): boolean => branch.checkoutFolder !== "";

const isCheckedOutInRepoFolder = (branch: LocalBranch): boolean =>
  isCheckedOut(branch) && realFolder(branch.checkoutFolder) === realFolder(branch.repoFolder);

// A branch checked out in a linked worktree goes with that worktree, so the worktree pass decides about it.
const isFreeOfWorktrees = (branch: LocalBranch): boolean => !isCheckedOut(branch) || isCheckedOutInRepoFolder(branch);

// A branch whose commits cannot be listed counts as unpushed, so it is reported as kept rather than skipped unseen.
const hasUnpushedCommits = (branch: LocalBranch): boolean => {
  const unpushedQuery = ["log", `refs/heads/${branch.branch}`, "--not", "--remotes", "--max-count=1", "--format=%H"];
  const unpushedCommits = gitAnswerLines({ folder: branch.repoFolder, query: unpushedQuery });
  return unpushedCommits === undefined || unpushedCommits.length > 0;
};

const pushUnpushedBranch = (request: {
  readonly branch: LocalBranch;
  readonly inUse: boolean;
  readonly dryRun: boolean;
}): string => {
  const { repoFolder, branch } = request.branch;
  const target = `${repoFolder} ${branch}`;
  const facts = readBranchFacts({ folder: repoFolder, branch, inUse: request.inUse });
  const decision = decideBranchPush(facts);
  if (decision._tag === "keep") {
    return reportLine({ action: "kept", detail: decision.reason, target });
  }

  if (request.dryRun) {
    return reportLine({ action: "would push", detail: `to ${facts.remote}`, target });
  }

  if (!pushBranch({ folder: repoFolder, remote: facts.remote, branch })) {
    return reportLine({ action: "kept", detail: "push failed", target });
  }

  return reportLine({ action: "pushed", detail: `to ${facts.remote}`, target });
};

// Commits on a local branch that no remote holds are lost with the disk. Only repos the ended session named are
// looked at, and a manual pass looks at every repo under the code roots.
export const pushUnpushedBranches = (request: BranchCleanupRequest): ReadonlyArray<string> => {
  const roots = codeRootFolders(request);
  const repoFolders = repoRootsUnder(roots);
  const ownedRepoFolders = foldersOwnedBy({ ...request, folders: repoFolders, roots });
  const unpushedBranches = ownedRepoFolders
    .flatMap(localBranchesOf)
    .filter(isFreeOfWorktrees)
    .filter(hasUnpushedCommits);
  const worktreeFolders = unpushedBranches.filter(isCheckedOut).map((branch) => branch.repoFolder);
  const usedFolders = worktreesInUse({ ...request, worktreeFolders, roots });
  return unpushedBranches.map((branch) => {
    const inUse = isCheckedOut(branch) && usedFolders.has(branch.repoFolder);
    return pushUnpushedBranch({ branch, inUse, dryRun: request.dryRun });
  });
};
