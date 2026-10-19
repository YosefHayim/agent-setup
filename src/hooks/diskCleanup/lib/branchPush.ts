import { gitSucceeds } from "../../lib/gitAnswers.js";

// A pre-push hook may run a whole test suite.
const PUSH_TIMEOUT_MILLISECONDS = 5 * 60 * 1_000;

type BranchPush = {
  readonly folder: string;
  readonly remote: string;
  readonly branch: string;
  readonly commit: string;
};

// --set-upstream sets nothing when the pushed source is a commit rather than a branch name.
const trackPushedBranch = (request: BranchPush): boolean => {
  const { folder, remote, branch } = request;
  const mergedRef = `refs/heads/${branch}`;
  return (
    gitSucceeds({ folder, query: ["config", `branch.${branch}.remote`, remote] }) &&
    gitSucceeds({ folder, query: ["config", `branch.${branch}.merge`, mergedRef] })
  );
};

// The push sends the commit whose files were checked, so one committed meanwhile waits for a later pass. It always goes
// to a branch of the same name, never to whatever the branch tracks, which can be main. It is never forced, so a remote
// branch that has moved on refuses it.
export const pushBranch = (request: BranchPush): boolean => {
  // An empty source would delete the remote branch.
  if (request.commit === "") {
    return false;
  }

  const pushed = gitSucceeds({
    folder: request.folder,
    query: ["push", "--quiet", request.remote, `${request.commit}:refs/heads/${request.branch}`],
    timeoutMilliseconds: PUSH_TIMEOUT_MILLISECONDS,
  });
  return pushed && trackPushedBranch(request);
};
