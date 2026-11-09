import { gitAnswerLines } from "../../lib/git-answers.js";
import type { BranchFacts } from "./branch-push-decision.js";
import { isDefaultBranch, remoteDefaultBranch, remoteFor } from "./branch-remote.js";
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
  const committedFiles = gitAnswerLines({ folder, query: ["log", ...unpushedRange, ...COMMITTED_FILE_FORMAT] });
  const largeBlobLines = readLargeBlobLines({ folder, range: unpushedRange });
  const hasLargeFile = hasLargeBlob(largeBlobLines || []);
  const hasRiskyNamedFile = (committedFiles || []).some(hasRiskyName);
  const remote = remoteFor({ folder, branch });
  const remoteDefault = remoteDefaultBranch({ folder, remote });
  return {
    inUse: request.inUse,
    readable: committedFiles !== undefined && largeBlobLines !== undefined,
    isDefaultBranch: isDefaultBranch({ branch, remoteDefault }),
    knowsDefaultBranch: remoteDefault !== "",
    hasRiskyFiles: hasLargeFile || hasRiskyNamedFile,
    remote,
  };
};
