import { gitAnswerLines } from "../../lib/gitAnswers.js";

export type LinkedWorktree = {
  readonly folder: string;
  readonly mainFolder: string;
  /** "" when the worktree has no branch checked out. */
  readonly branch: string;
  readonly locked: boolean;
  /** Its folder is gone, so only git's record of it is left. */
  readonly prunable: boolean;
};

const WORKTREE_LIST_QUERY = ["worktree", "list", "--porcelain"];
const FOLDER_LINE_START = "worktree ";
const BRANCH_LINE_START = "branch refs/heads/";

// Each worktree starts with "worktree <folder>", followed by lines such as "branch refs/heads/feature", "detached",
// "locked <reason>", and "prunable <reason>". The main worktree comes first.
const worktreeBlocks = (listLines: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> => {
  const blockStarts = listLines.flatMap((line, position) => (line.startsWith(FOLDER_LINE_START) ? [position] : []));
  return blockStarts.map((blockStart, order) => listLines.slice(blockStart, blockStarts[order + 1]));
};

const hasFlag = (request: { readonly block: ReadonlyArray<string>; readonly flag: string }): boolean =>
  request.block.some((line) => line === request.flag || line.startsWith(`${request.flag} `));

const linkedWorktreeFrom = (request: { readonly block: ReadonlyArray<string>; readonly mainFolder: string }) => {
  const branchLine = request.block.find((line) => line.startsWith(BRANCH_LINE_START)) || BRANCH_LINE_START;
  return {
    folder: request.block[0].slice(FOLDER_LINE_START.length),
    mainFolder: request.mainFolder,
    branch: branchLine.slice(BRANCH_LINE_START.length),
    locked: hasFlag({ block: request.block, flag: "locked" }),
    prunable: hasFlag({ block: request.block, flag: "prunable" }),
  };
};

type RepoWorktreeList = { readonly repoRoot: string; readonly listLines: ReadonlyArray<string> | undefined };

// A repo git cannot list is named, rather than taken for one without worktrees.
export type LinkedWorktreeListing = {
  readonly worktrees: ReadonlyArray<LinkedWorktree>;
  readonly unreadableRepoRoots: ReadonlyArray<string>;
};

const readWorktreeList = (repoRoot: string): RepoWorktreeList => {
  const listLines = gitAnswerLines({ folder: repoRoot, query: WORKTREE_LIST_QUERY });
  return { repoRoot, listLines };
};

const linkedWorktreesOf = (worktreeList: RepoWorktreeList): ReadonlyArray<LinkedWorktree> => {
  const [mainBlock, ...linkedBlocks] = worktreeBlocks(worktreeList.listLines || []);
  if (!mainBlock) {
    return [];
  }

  const mainFolder = mainBlock[0].slice(FOLDER_LINE_START.length);
  return linkedBlocks.map((block) => linkedWorktreeFrom({ block, mainFolder }));
};

// A repo root can itself be a linked worktree, so the same worktree can come up from several roots.
export const listLinkedWorktrees = (repoRoots: ReadonlyArray<string>): LinkedWorktreeListing => {
  const worktreeLists = repoRoots.map(readWorktreeList);
  const worktrees = worktreeLists.flatMap(linkedWorktreesOf);
  const worktreeByFolder = new Map(worktrees.map((worktree) => [worktree.folder, worktree]));
  const unreadableLists = worktreeLists.filter((worktreeList) => !worktreeList.listLines);
  const unreadableRepoRoots = unreadableLists.map((worktreeList) => worktreeList.repoRoot);
  return { worktrees: [...worktreeByFolder.values()], unreadableRepoRoots };
};
