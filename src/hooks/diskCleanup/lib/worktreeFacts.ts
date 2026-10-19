import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { gitAnswerLines } from "../../lib/gitAnswers.js";
import { isDefaultBranch, remoteDefaultBranch, remoteFor } from "./branchRemote.js";
import type { LinkedWorktree } from "./linkedWorktrees.js";
import {
  COMMITTED_FILE_FORMAT,
  hasRiskyName,
  isSecretFile,
  LARGE_FILE_BYTES,
  SECRET_FILE_GLOBS,
} from "./riskyFiles.js";
import type { WorktreeFacts } from "./worktreeCleanupDecision.js";

const CHANGE_QUERY = ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"];
// Without --directory git also lists the files inside ignored folders, e.g. .vercel/.env.development.local, and the
// pathspecs keep that list to secret-looking names.
const IGNORED_SECRET_QUERY = [
  "ls-files",
  "--others",
  "--ignored",
  "--exclude-standard",
  "--",
  ...SECRET_FILE_GLOBS.map((glob) => `:(glob,icase)**/${glob}`),
];
// Installed packages ship test keys of their own, e.g. node_modules/some-lib/test/server.pem.
const DEPENDENCY_FOLDERS = new Set(["node_modules", ".venv", "Pods"]);
const BRANCH_UNPUSHED_RANGE = ["HEAD", "--not", "--remotes"];
// A detached HEAD's commits are only at risk when no branch, tag, or remote holds them.
const DETACHED_UNPUSHED_RANGE = ["HEAD", "--not", "--branches", "--tags", "--remotes"];
const LATEST_COMMIT_FORMAT = ["--max-count=1", "--format=%H"];
// git writes a linked worktree's .git file once, when it adds the worktree.
const RECENT_WORKTREE_MILLISECONDS = 60 * 60 * 1_000;

const fileBytes = (file: string): number => {
  try {
    return statSync(file).size;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const isRiskyToPush = (request: { readonly folder: string; readonly relativePath: string }): boolean => {
  const isLarge = fileBytes(path.join(request.folder, request.relativePath)) > LARGE_FILE_BYTES;
  return isLarge || hasRiskyName(request.relativePath);
};

// Porcelain lines read "XY path", or "XY old -> new" for a rename; a deleted file has nothing left to push.
const changedPaths = (changeLines: ReadonlyArray<string>): ReadonlyArray<string> =>
  changeLines.filter((line) => !line.slice(0, 2).includes("D")).map((line) => line.slice(3).split(" -> ").at(-1) || "");

const isInsideDependencies = (relativePath: string): boolean =>
  relativePath.split("/").some((folderName) => DEPENDENCY_FOLDERS.has(folderName));

// Removing a worktree deletes its ignored files, so an ignored secret file is only safe to lose when the main
// worktree holds the same file. One that cannot be read cannot be compared.
const isUniqueIgnoredSecret = (request: { readonly worktree: LinkedWorktree; readonly relativePath: string }) => {
  if (!isSecretFile(request.relativePath) || isInsideDependencies(request.relativePath)) {
    return false;
  }

  try {
    const worktreeContent = readFileSync(path.join(request.worktree.folder, request.relativePath));
    const mainContent = readFileSync(path.join(request.worktree.mainFolder, request.relativePath));
    return !worktreeContent.equals(mainContent);
  } catch {
    return true;
  }
};

const isCreatedRecently = (folder: string): boolean => {
  try {
    const createdAt = statSync(path.join(folder, ".git")).mtimeMs;
    return Date.now() - createdAt < RECENT_WORKTREE_MILLISECONDS;
  } catch {
    return true;
  }
};

export const readWorktreeFacts = (request: { readonly worktree: LinkedWorktree; readonly inUse: boolean }) => {
  const { worktree } = request;
  const detached = worktree.branch === "";
  const unpushedRange = detached ? DETACHED_UNPUSHED_RANGE : BRANCH_UNPUSHED_RANGE;
  const changeLines = gitAnswerLines({ folder: worktree.folder, query: CHANGE_QUERY });
  const ignoredSecrets = gitAnswerLines({ folder: worktree.folder, query: IGNORED_SECRET_QUERY });
  const unpushedCommits = gitAnswerLines({
    folder: worktree.folder,
    query: ["log", ...unpushedRange, ...LATEST_COMMIT_FORMAT],
  });
  const committedFiles = gitAnswerLines({
    folder: worktree.folder,
    query: ["log", ...unpushedRange, ...COMMITTED_FILE_FORMAT],
  });
  const pathsToPush = [...changedPaths(changeLines || []), ...(committedFiles || [])];
  const hasRiskyFileToPush = pathsToPush.some((relativePath) =>
    isRiskyToPush({ folder: worktree.folder, relativePath }),
  );
  const hasUniqueIgnoredSecret = (ignoredSecrets || []).some((relativePath) =>
    isUniqueIgnoredSecret({ worktree, relativePath }),
  );
  const remote = remoteFor(worktree);
  const remoteDefault = remoteDefaultBranch({ folder: worktree.folder, remote });
  const gitAnswers = [changeLines, ignoredSecrets, unpushedCommits, committedFiles];
  const facts: WorktreeFacts = {
    inUse: request.inUse,
    createdRecently: isCreatedRecently(worktree.folder),
    locked: worktree.locked,
    readable: gitAnswers.every((answer) => answer !== undefined),
    detached,
    onDefaultBranch: isDefaultBranch({ branch: worktree.branch, remoteDefault }),
    knowsDefaultBranch: remoteDefault !== "",
    hasChanges: (changeLines || []).length > 0,
    hasUnpushedCommits: (unpushedCommits || []).length > 0,
    hasRiskyFiles: hasRiskyFileToPush || hasUniqueIgnoredSecret,
    remote,
  };
  return facts;
};
