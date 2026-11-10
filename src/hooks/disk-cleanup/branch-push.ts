import { isGitSuccessful, readGitFailureString } from "../git-answers.js";

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
    isGitSuccessful({ folder, query: ["config", `branch.${branch}.remote`, remote] }) &&
    isGitSuccessful({ folder, query: ["config", `branch.${branch}.merge`, mergedRef] })
  );
};

const MOVED_ON_ERROR = /non-fast-forward|fetch first|\[rejected\]/u;
const HOOK_ERROR = /pre-push|hook/iu;
// A hook that fails silently still ends in git's generic refusal, while a remote that turns a ref down names it first.
const GENERIC_REFUSAL = "failed to push some refs";
const REFUSED_REF_LINE = /^ ?! \[/mu;
const REASON_LIMIT = 120;

export type BranchPushStatus = { readonly _tag: "pushed" } | { readonly _tag: "failed"; readonly reason: string };

const createFailedPush = (reason: string): BranchPushStatus => ({ _tag: "failed", reason });

const pushFailureReason = (errorString: string): string => {
  const isMovedOnError = MOVED_ON_ERROR.test(errorString);
  if (isMovedOnError) {
    return "remote moved on";
  }

  const isGenericRefusal = errorString.includes(GENERIC_REFUSAL) && !REFUSED_REF_LINE.test(errorString);

  const isHookError = HOOK_ERROR.test(errorString) || isGenericRefusal;
  if (isHookError) {
    return "pre-push hook failed";
  }

  const errorLines = errorString.split("\n").map((line) => line.trim());
  const firstLine = errorLines.find((line) => line !== "") || "no error text";
  return firstLine.slice(0, REASON_LIMIT);
};

// The push sends the commit whose files were checked, so one committed meanwhile waits for a later pass. It always goes
// to a branch of the same name, never to whatever the branch tracks, which can be main. It is never forced, so a remote
// branch that has moved on refuses it.
export const pushBranch = (request: BranchPush): BranchPushStatus => {
  // An empty source would delete the remote branch.
  const isCommitEmpty = request.commit === "";
  if (isCommitEmpty) {
    return createFailedPush("no commit to push");
  }

  const errorString = readGitFailureString({
    folder: request.folder,
    query: ["push", "--quiet", request.remote, `${request.commit}:refs/heads/${request.branch}`],
    timeoutMilliseconds: PUSH_TIMEOUT_MILLISECONDS,
  });

  const hasErrorString = errorString != null;
  if (hasErrorString) {
    return createFailedPush(pushFailureReason(errorString));
  }

  const isTrackingFailed = !trackPushedBranch(request);
  if (isTrackingFailed) {
    return createFailedPush("upstream not set");
  }

  return { _tag: "pushed" };
};
