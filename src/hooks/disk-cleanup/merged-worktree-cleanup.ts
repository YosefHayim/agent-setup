import { listCodeRootFolders, listRepoRootsUnder } from "../code-repos.js";
import { isGitSuccessful, readGitAnswerLines } from "../git-answers.js";
import { isInsideAnyFolder, readFolderPaths } from "./folder-paths.js";
import { type LinkedWorktree, listLinkedWorktrees } from "./linked-worktrees.js";
import { decideMergedWorktreeCleanup, type MergedWorktreeFacts } from "./merged-worktree-decision.js";
import { reportLine } from "./report-line.js";
import { isUsedByRunningProcess, readRunningProcesses, readSystemToolCall } from "./running-processes.js";

interface MergedWorktreeCleanupRequest {
  readonly homeRoot: string;
  readonly rootFolders: ReadonlyArray<string>;
  readonly dryRun: boolean;
}

interface RepoWorktrees {
  readonly mainFolder: string;
  readonly worktrees: ReadonlyArray<LinkedWorktree>;
}

interface RepoMergedWorktrees {
  readonly mainFolder: string;
  // null when gh could not list the merged pull requests.
  readonly mergedWorktrees: ReadonlyArray<LinkedWorktree> | null;
}

interface MergedWorktreeReport {
  readonly worktree: LinkedWorktree;
  readonly line: string;
  readonly wasRemoved: boolean;
}

const RECENT_CHANGE_MINUTES = 120;
const MERGED_PULL_REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const MERGED_PULL_REQUEST_QUERY = ["pr", "list", "--state", "merged", "--limit", "1000", "--json", "headRefName"];
const CHANGED_FILES_QUERY = ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"];

const groupWorktreesByRepo = (worktrees: ReadonlyArray<LinkedWorktree>): ReadonlyArray<RepoWorktrees> => {
  const mainFolders = [...new Set(worktrees.map((worktree) => worktree.mainFolder))];
  return mainFolders.map((mainFolder) => ({
    mainFolder,
    worktrees: worktrees.filter((worktree) => worktree.mainFolder === mainFolder),
  }));
};

const readMergedBranchNames = (repoFolder: string): ReadonlySet<string> | null => {
  const pullRequestList = readSystemToolCall({
    tool: "gh",
    toolArguments: MERGED_PULL_REQUEST_QUERY,
    workingFolder: repoFolder,
    timeoutMilliseconds: MERGED_PULL_REQUEST_TIMEOUT_MILLISECONDS,
  });

  const hasGhFailed = pullRequestList.error != null || pullRequestList.status !== 0;
  if (hasGhFailed) {
    return null;
  }

  try {
    const parsedList: unknown = JSON.parse(pullRequestList.stdout);

    const isNotList = !Array.isArray(parsedList);
    if (isNotList) {
      return null;
    }

    const headBranchNames = parsedList.flatMap((pullRequest) =>
      typeof pullRequest?.headRefName === "string" ? [pullRequest.headRefName] : [],
    );
    return new Set(headBranchNames);
  } catch {
    return null;
  }
};

const isDetachedOnOriginMain = (worktree: LinkedWorktree): boolean => {
  const isOnBranch = worktree.branch !== "";
  if (isOnBranch) {
    return false;
  }

  return isGitSuccessful({ folder: worktree.folder, query: ["merge-base", "--is-ancestor", "HEAD", "origin/main"] });
};

const readRepoMergedWorktrees = (repo: RepoWorktrees): RepoMergedWorktrees => {
  const mergedBranchNames = readMergedBranchNames(repo.mainFolder);

  const hasGhFailed = mergedBranchNames === null;
  if (hasGhFailed) {
    return { mainFolder: repo.mainFolder, mergedWorktrees: null };
  }

  const mergedWorktrees = repo.worktrees.filter(
    (worktree) => mergedBranchNames.has(worktree.branch) || isDetachedOnOriginMain(worktree),
  );
  return { mainFolder: repo.mainFolder, mergedWorktrees };
};

// null when find could not tell. find prints the first changed file it meets, and fails on a folder it cannot read.
const hasRecentFile = (request: {
  readonly searchFolder: string;
  readonly findArguments: ReadonlyArray<string>;
}): boolean | null => {
  const found = readSystemToolCall({
    tool: "find",
    toolArguments: [
      request.searchFolder,
      ...request.findArguments,
      "-mmin",
      `-${RECENT_CHANGE_MINUTES}`,
      "-print",
      "-quit",
    ],
  });

  const isFileFound = found.stdout.trim() !== "";
  if (isFileFound) {
    return true;
  }

  const hasFindFailed = found.error != null || found.status !== 0;
  if (hasFindFailed) {
    return null;
  }

  return false;
};

const WORKTREE_FILES_ARGUMENTS = ["(", "-name", "node_modules", "-o", "-name", ".git", ")", "-prune", "-o"];
// git status rewrites index, so a worktree that was only looked at would never go quiet.
const GIT_FOLDER_FILES_ARGUMENTS = ["-maxdepth", "1", "-type", "f", "-not", "-name", "index"];

const readMergedWorktreeFacts = (request: {
  readonly worktree: LinkedWorktree;
  readonly isInUse: boolean;
}): MergedWorktreeFacts => {
  const { worktree } = request;
  const gitFolderLines = readGitAnswerLines({ folder: worktree.folder, query: ["rev-parse", "--absolute-git-dir"] });
  const changedFileLines = readGitAnswerLines({ folder: worktree.folder, query: CHANGED_FILES_QUERY });
  const hasRecentWorktreeFile = hasRecentFile({
    searchFolder: worktree.folder,
    findArguments: WORKTREE_FILES_ARGUMENTS,
  });

  const isGitFolderUnknown = gitFolderLines === null || gitFolderLines.length === 0;
  const hasRecentGitFile = isGitFolderUnknown
    ? null
    : hasRecentFile({ searchFolder: gitFolderLines[0], findArguments: GIT_FOLDER_FILES_ARGUMENTS });

  const isReadable = changedFileLines !== null && hasRecentWorktreeFile !== null && hasRecentGitFile !== null;
  return {
    isLocked: worktree.locked,
    isInUse: request.isInUse,
    isReadable,
    hasRecentChange: hasRecentWorktreeFile === true || hasRecentGitFile === true,
    hasUncommittedFiles: changedFileLines === null || changedFileLines.length > 0,
  };
};

// A process that holds a file in a worktree or names it on its command line uses it, by any path it goes by. When the
// processes cannot be listed, nothing can be ruled out.
const readFoldersUsedByProcesses = (request: {
  readonly worktreeFolders: ReadonlyArray<string>;
  readonly roots: ReadonlyArray<string>;
}): ReadonlySet<string> => {
  const processes = readRunningProcesses();

  const hasNoProcesses = processes === null;
  if (hasNoProcesses) {
    return new Set(request.worktreeFolders);
  }

  const usedFolders = request.worktreeFolders.filter((folder) => {
    const folderPaths = readFolderPaths({ folder, roots: request.roots });
    return isUsedByRunningProcess({ paths: folderPaths.paths, processes });
  });
  return new Set(usedFolders);
};

const removeMergedWorktree = (worktree: LinkedWorktree): MergedWorktreeReport => {
  const isRemoved = isGitSuccessful({ folder: worktree.mainFolder, query: ["worktree", "remove", worktree.folder] });

  const isRemoveFailed = !isRemoved;
  if (isRemoveFailed) {
    return {
      worktree,
      wasRemoved: false,
      line: reportLine({ action: "kept", detail: "remove failed", target: worktree.folder }),
    };
  }

  return {
    worktree,
    wasRemoved: true,
    line: reportLine({ action: "removed", detail: "pr-merged", target: worktree.folder }),
  };
};

const applyRemoval = (request: {
  readonly worktree: LinkedWorktree;
  readonly dryRun: boolean;
}): MergedWorktreeReport => {
  const { worktree } = request;

  const isDryRun = request.dryRun;
  if (isDryRun) {
    const plannedLine = reportLine({ action: "would remove", detail: "pr-merged", target: worktree.folder });
    return { worktree, wasRemoved: false, line: plannedLine };
  }

  return removeMergedWorktree(worktree);
};

const cleanUpMergedWorktree = (request: {
  readonly worktree: LinkedWorktree;
  readonly isInUse: boolean;
  readonly dryRun: boolean;
}): MergedWorktreeReport => {
  const { worktree } = request;
  const facts = readMergedWorktreeFacts(request);
  const decision = decideMergedWorktreeCleanup(facts);
  switch (decision._tag) {
    case "keep":
      return {
        worktree,
        wasRemoved: false,
        line: reportLine({ action: "kept", detail: decision.reason, target: worktree.folder }),
      };
    case "remove":
      return applyRemoval({ worktree, dryRun: request.dryRun });
  }
};

// Git keeps a removed worktree's record until it is pruned, once per repo.
const pruneRepos = (mainFolders: ReadonlyArray<string>): ReadonlyArray<string> =>
  mainFolders
    .filter((folder) => !isGitSuccessful({ folder, query: ["worktree", "prune"] }))
    .map((folder) => reportLine({ action: "kept", detail: "prune failed", target: folder }));

// A second pass over every worktree under the code roots, whoever made it: one whose PR is merged goes once it is clean,
// quiet for 2 hours, and used by nothing. Branches stay.
export const cleanUpMergedWorktrees = (request: MergedWorktreeCleanupRequest): ReadonlyArray<string> => {
  const roots = listCodeRootFolders(request);
  const repoRoots = listRepoRootsUnder(roots);
  const rootPaths = roots.flatMap((root) => readFolderPaths({ folder: root, roots: [] }).paths);
  const worktreeListing = listLinkedWorktrees(repoRoots);
  const codeWorktrees = worktreeListing.worktrees.filter(
    (worktree) => !worktree.prunable && isInsideAnyFolder({ candidate: worktree.folder, folders: rootPaths }),
  );
  const repoReplies = groupWorktreesByRepo(codeWorktrees).map(readRepoMergedWorktrees);
  const mergedWorktrees = repoReplies.flatMap((repoReply) => repoReply.mergedWorktrees ?? []);
  const worktreeFolders = mergedWorktrees.map((worktree) => worktree.folder);
  const usedFolders = readFoldersUsedByProcesses({ worktreeFolders, roots });
  const reports = mergedWorktrees.map((worktree) =>
    cleanUpMergedWorktree({ worktree, isInUse: usedFolders.has(worktree.folder), dryRun: request.dryRun }),
  );
  const removedMainFolders = [
    ...new Set(reports.filter((report) => report.wasRemoved).map((report) => report.worktree.mainFolder)),
  ];
  const ghFailedLines = repoReplies
    .filter((repoReply) => repoReply.mergedWorktrees === null)
    .map((repoReply) => reportLine({ action: "kept", detail: "gh failed", target: repoReply.mainFolder }));
  return [...reports.map((report) => report.line), ...ghFailedLines, ...pruneRepos(removedMainFolders)];
};
