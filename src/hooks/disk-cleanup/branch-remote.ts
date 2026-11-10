import { readGitAnswerLines } from "../git-answers.js";

const REMOTE_LIST_QUERY = ["remote"];
// They count as the default branch even when the remote never said which one it is.
const ALWAYS_DEFAULT_BRANCHES = ["main", "master"];

// The branch is "" for a detached HEAD.
export const readRemoteFor = (request: { readonly folder: string; readonly branch: string }): string => {
  const remotes = readGitAnswerLines({ folder: request.folder, query: REMOTE_LIST_QUERY }) || [];
  const branchRemoteQuery = ["config", "--get", `branch.${request.branch}.remote`];

  const isBranchKnown = request.branch;
  const branchRemotes = isBranchKnown ? readGitAnswerLines({ folder: request.folder, query: branchRemoteQuery }) : [];
  const trackedRemote = (branchRemotes || []).find((remote) => remotes.includes(remote));
  return trackedRemote || remotes.find((remote) => remote === "origin") || remotes[0] || "";
};

// e.g. "main" from refs/remotes/origin/HEAD, or "" when the remote never said.
export const readRemoteDefaultBranch = (request: { readonly folder: string; readonly remote: string }): string => {
  const isRequestRemoteMissing = !request.remote;
  if (isRequestRemoteMissing) {
    return "";
  }

  const remoteHeadQuery = ["symbolic-ref", "--short", `refs/remotes/${request.remote}/HEAD`];
  const remoteHeadLines = readGitAnswerLines({ folder: request.folder, query: remoteHeadQuery }) || [];
  const remoteHead = remoteHeadLines[0] || "";
  return remoteHead.slice(request.remote.length + 1);
};

export const isDefaultBranch = (request: { readonly branch: string; readonly remoteDefault: string }): boolean => {
  const defaultBranches = [...ALWAYS_DEFAULT_BRANCHES, request.remoteDefault].filter(Boolean);
  return defaultBranches.includes(request.branch);
};
