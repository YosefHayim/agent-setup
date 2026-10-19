import { gitSucceeds } from "../../lib/gitAnswers.js";

// A pre-push hook may run a whole test suite.
const PUSH_TIMEOUT_MILLISECONDS = 5 * 60 * 1_000;

// The push always goes to a branch of the same name, never to whatever the branch tracks, which can be main. It is
// never forced, so a remote branch that has moved on refuses it.
export const pushBranch = (request: {
  readonly folder: string;
  readonly remote: string;
  readonly branch: string;
}): boolean => {
  const branchRef = `refs/heads/${request.branch}`;
  return gitSucceeds({
    folder: request.folder,
    query: ["push", "--quiet", "--set-upstream", request.remote, `${branchRef}:${branchRef}`],
    timeoutMilliseconds: PUSH_TIMEOUT_MILLISECONDS,
  });
};
