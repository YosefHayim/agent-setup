import { gitAnswerLines } from "../../lib/gitAnswers.js";
import type { BranchFacts } from "./branchPushDecision.js";
import { isDefaultBranch, remoteDefaultBranch, remoteFor } from "./branchRemote.js";
import { COMMITTED_FILE_FORMAT, hasRiskyName, LARGE_FILE_BYTES } from "./riskyFiles.js";

// Lists every object the unpushed commits bring, and "~<id>" for each blob it leaves out for its size. The branch is
// not checked out, so its files cannot be measured on disk.
const LARGE_BLOB_QUERY = [
  "rev-list",
  "--objects",
  "--no-object-names",
  `--filter=blob:limit=${LARGE_FILE_BYTES}`,
  "--filter-print-omitted",
];
const OMITTED_OBJECT_MARK = "~";

export const readBranchFacts = (request: {
  readonly folder: string;
  readonly branch: string;
  readonly inUse: boolean;
}): BranchFacts => {
  const { folder, branch } = request;
  const unpushedRange = [`refs/heads/${branch}`, "--not", "--remotes"];
  const committedFiles = gitAnswerLines({ folder, query: ["log", ...unpushedRange, ...COMMITTED_FILE_FORMAT] });
  const unpushedObjects = gitAnswerLines({ folder, query: [...LARGE_BLOB_QUERY, ...unpushedRange] });
  const hasLargeFile = (unpushedObjects || []).some((line) => line.startsWith(OMITTED_OBJECT_MARK));
  const hasRiskyNamedFile = (committedFiles || []).some(hasRiskyName);
  const remote = remoteFor({ folder, branch });
  const remoteDefault = remoteDefaultBranch({ folder, remote });
  return {
    inUse: request.inUse,
    readable: committedFiles !== undefined && unpushedObjects !== undefined,
    isDefaultBranch: isDefaultBranch({ branch, remoteDefault }),
    knowsDefaultBranch: remoteDefault !== "",
    hasRiskyFiles: hasLargeFile || hasRiskyNamedFile,
    remote,
  };
};
