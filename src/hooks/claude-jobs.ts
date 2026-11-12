import { readFileSync } from "node:fs";
import path from "node:path";

import { listClaudeSettingsRoots } from "./claude-live-sessions.js";
import { listFolderNames } from "./folder-entries.js";
import { isPlainObject } from "./json-lines.js";

interface ClaudeJob {
  readonly jobFolder: string;
  readonly status: Record<string, unknown>;
}

const listJobStatusIn = (storageFile: string): ReadonlyArray<Record<string, unknown>> => {
  try {
    const jobStatus: unknown = JSON.parse(readFileSync(storageFile, "utf8"));
    return isPlainObject(jobStatus) ? [jobStatus] : [];
  } catch {
    return [];
  }
};

// Claude Code keeps each background job at <config root>/jobs/<job>/state.json, beside the job's own files, which can
// run to hundreds of thousands, so only that one file of each job is read. A job runs until its state says "done";
// a working, blocked or stopped job can still be resumed. A config root that never ran a background job has no jobs
// folder, and one that cannot be listed throws, since any job could be running.
const listClaudeJobs = (homeRoot: string): ReadonlyArray<ClaudeJob> =>
  listClaudeSettingsRoots(homeRoot).flatMap((settingsRoot) => {
    const jobsFolder = path.join(settingsRoot, "jobs");
    const jobNames = listFolderNames({ folder: jobsFolder, recursive: false });
    return jobNames.flatMap((jobName) => {
      const jobFolder = path.join(jobsFolder, jobName);
      return listJobStatusIn(path.join(jobFolder, "state.json")).map((status) => ({ jobFolder, status }));
    });
  });

export const listUnfinishedClaudeJobStatuses = (homeRoot: string): ReadonlyArray<Record<string, unknown>> =>
  listClaudeJobs(homeRoot)
    .map((job) => job.status)
    .filter((jobStatus) => jobStatus.state !== "done");

// A done job is never resumed, so what runs from its tmp folder is left over.
export const listFinishedClaudeJobTmpFolders = (homeRoot: string): ReadonlyArray<string> =>
  listClaudeJobs(homeRoot)
    .filter((job) => job.status.state === "done")
    .map((job) => path.join(job.jobFolder, "tmp"));
