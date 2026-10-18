import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { gitAnswerLines } from "../../lib/gitAnswers.js";
import { escapeForPattern } from "../../lib/patternEscape.js";
import type { LinkedWorktree } from "./linkedWorktrees.js";
import type { WorktreeFacts } from "./worktreeCleanupDecision.js";

// Environment files, keys, certificates, and SSH identities, e.g. server.pem, signing.p12, id_ed25519.
const SECRET_FILE_GLOBS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "*.jks",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
  "id_dsa*",
];
const SHAREABLE_ENV_FILE = /^\.env\.(?:example|sample|template)$/u;
const CHANGE_QUERY = ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"];
// Without --directory git also lists the files inside ignored folders, e.g. .vercel/.env.development.local, and the
// pathspecs keep that list to secret-looking names.
const IGNORED_SECRET_QUERY = [
  "ls-files",
  "--others",
  "--ignored",
  "--exclude-standard",
  "--",
  ...SECRET_FILE_GLOBS.map((glob) => `:(glob)**/${glob}`),
];
// Installed packages ship test keys of their own, e.g. node_modules/some-lib/test/server.pem.
const DEPENDENCY_FOLDERS = new Set(["node_modules", ".venv", "Pods"]);
const BRANCH_UNPUSHED_RANGE = ["HEAD", "--not", "--remotes"];
// A detached HEAD's commits are only at risk when no branch, tag, or remote holds them.
const DETACHED_UNPUSHED_RANGE = ["HEAD", "--not", "--branches", "--tags", "--remotes"];
const LATEST_COMMIT_FORMAT = ["--max-count=1", "--format=%H"];
// Every file an unpushed commit adds or changes; a deleted one has nothing left to push.
const COMMITTED_FILE_FORMAT = ["--format=", "--name-only", "--diff-filter=d"];
const REMOTE_LIST_QUERY = ["remote"];
// GitHub refuses files over 100 MB; one this big in a worktree is a build or a download, not work.
const LARGE_FILE_BYTES = 50 * 1024 * 1024;
// git writes a linked worktree's .git file once, when it adds the worktree.
const RECENT_WORKTREE_MILLISECONDS = 60 * 60 * 1_000;
// They count as the default branch even when the remote never said which one it is.
const ALWAYS_DEFAULT_BRANCHES = ["main", "master"];

const globPattern = (glob: string): RegExp => {
  const literalParts = glob.split("*").map(escapeForPattern);
  return new RegExp(`^${literalParts.join(".*")}$`, "u");
};

const SECRET_FILE_PATTERNS = SECRET_FILE_GLOBS.map(globPattern);

const isSecretFile = (relativePath: string): boolean => {
  const fileName = path.basename(relativePath);
  const looksSecret = SECRET_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
  return looksSecret && !SHAREABLE_ENV_FILE.test(fileName);
};

const fileBytes = (file: string): number => {
  try {
    return statSync(file).size;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

// A pushed secret cannot be taken back, and a file git had to quote has a name too odd to check.
const isRiskyToPush = (request: { readonly folder: string; readonly relativePath: string }): boolean => {
  const isQuoted = request.relativePath.startsWith('"');
  const isLarge = fileBytes(path.join(request.folder, request.relativePath)) > LARGE_FILE_BYTES;
  return isQuoted || isLarge || isSecretFile(request.relativePath);
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

const remoteFor = (worktree: LinkedWorktree): string => {
  const remotes = gitAnswerLines({ folder: worktree.folder, query: REMOTE_LIST_QUERY }) || [];
  const branchRemoteQuery = ["config", "--get", `branch.${worktree.branch}.remote`];
  const branchRemotes = worktree.branch ? gitAnswerLines({ folder: worktree.folder, query: branchRemoteQuery }) : [];
  const trackedRemote = (branchRemotes || []).find((remote) => remotes.includes(remote));
  return trackedRemote || remotes.find((remote) => remote === "origin") || remotes[0] || "";
};

// e.g. "main" from refs/remotes/origin/HEAD, or "" when the remote never said.
const remoteDefaultBranch = (request: { readonly folder: string; readonly remote: string }): string => {
  if (!request.remote) {
    return "";
  }

  const remoteHeadQuery = ["symbolic-ref", "--short", `refs/remotes/${request.remote}/HEAD`];
  const remoteHeadLines = gitAnswerLines({ folder: request.folder, query: remoteHeadQuery }) || [];
  const remoteHead = remoteHeadLines[0] || "";
  return remoteHead.slice(request.remote.length + 1);
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
  const defaultBranches = [...ALWAYS_DEFAULT_BRANCHES, remoteDefault].filter(Boolean);
  const gitAnswers = [changeLines, ignoredSecrets, unpushedCommits, committedFiles];
  const facts: WorktreeFacts = {
    inUse: request.inUse,
    createdRecently: isCreatedRecently(worktree.folder),
    locked: worktree.locked,
    readable: gitAnswers.every((answer) => answer !== undefined),
    detached,
    onDefaultBranch: defaultBranches.includes(worktree.branch),
    knowsDefaultBranch: remoteDefault !== "",
    hasChanges: (changeLines || []).length > 0,
    hasUnpushedCommits: (unpushedCommits || []).length > 0,
    hasRiskyFiles: hasRiskyFileToPush || hasUniqueIgnoredSecret,
    remote,
  };
  return facts;
};
