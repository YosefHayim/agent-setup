import { readGitAnswerLines } from "../git-answers.js";
import type { BranchFacts } from "./branch-push-decision.js";
import { isDefaultBranch, readRemoteDefaultBranch, readRemoteFor } from "./branch-remote.js";
import { hasLargeBlob, readLargeBlobLines } from "./large-blobs.js";
import { COMMITTED_FILE_FORMAT, hasRiskyName } from "./risky-files.js";

// The commits are read from the tip the branch had when listed, which is also the commit pushed.
export const readBranchFacts = (request: {
  readonly folder: string;
  readonly branch: string;
  readonly tip: string;
  readonly inUse: boolean;
}): BranchFacts => {
  const { folder, branch } = request;
  const unpushedRange = [request.tip, "--not", "--remotes"];
  const committedFiles = readGitAnswerLines({ folder, query: ["log", ...unpushedRange, ...COMMITTED_FILE_FORMAT] });
  const largeBlobLines = readLargeBlobLines({ folder, range: unpushedRange });
  const hasLargeFile = hasLargeBlob(largeBlobLines || []);
  const hasRiskyNamedFile = (committedFiles || []).some(hasRiskyName);
  const remote = readRemoteFor({ folder, branch });
  const remoteDefault = readRemoteDefaultBranch({ folder, remote });
  return {
    inUse: request.inUse,
    readable: committedFiles != null && largeBlobLines != null,
    isDefaultBranch: isDefaultBranch({ branch, remoteDefault }),
    knowsDefaultBranch: remoteDefault !== "",
    hasRiskyFiles: hasLargeFile || hasRiskyNamedFile,
    remote,
  };
};
