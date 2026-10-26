import { gitAnswerLines } from "../../lib/gitAnswers.js";
import { LARGE_FILE_BYTES } from "./riskyFiles.js";

// Lists every object the commits in a range bring, and "~<id>" for each blob it leaves out for its size. Committed
// content is measured in git, since a file the commits later deleted has nothing on disk to measure.
const LARGE_BLOB_QUERY = [
  "rev-list",
  "--objects",
  "--no-object-names",
  `--filter=blob:limit=${LARGE_FILE_BYTES}`,
  "--filter-print-omitted",
];
const OMITTED_OBJECT_MARK = "~";

// The commits in the range, e.g. ["HEAD", "--not", "--remotes"]. Undefined when git cannot list them.
export const readLargeBlobLines = (request: {
  readonly folder: string;
  readonly range: ReadonlyArray<string>;
}): ReadonlyArray<string> | undefined =>
  gitAnswerLines({ folder: request.folder, query: [...LARGE_BLOB_QUERY, ...request.range] });

export const hasLargeBlob = (largeBlobLines: ReadonlyArray<string>): boolean =>
  largeBlobLines.some((line) => line.startsWith(OMITTED_OBJECT_MARK));
