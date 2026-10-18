import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { claudeConfigRoots } from "./claudeLiveSessions.js";
import { isRecord } from "./jsonLines.js";

const jobNamesIn = (jobsFolder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(jobsFolder);
  } catch {
    // A config root that never ran a background job has no jobs folder.
    return [];
  }
};

const jobStateIn = (stateFile: string): ReadonlyArray<Record<string, unknown>> => {
  try {
    const jobState: unknown = JSON.parse(readFileSync(stateFile, "utf8"));
    return isRecord(jobState) ? [jobState] : [];
  } catch {
    return [];
  }
};

// Claude Code keeps each background job at <config root>/jobs/<job>/state.json, beside the job's own files, which can
// run to hundreds of thousands, so only that one file of each job is read. A job runs until its state says "done";
// a working, blocked or stopped job can still be resumed.
export const unfinishedClaudeJobStates = (homeRoot: string): ReadonlyArray<Record<string, unknown>> =>
  claudeConfigRoots(homeRoot)
    .flatMap((configRoot) => {
      const jobsFolder = path.join(configRoot, "jobs");
      return jobNamesIn(jobsFolder).flatMap((jobName) => jobStateIn(path.join(jobsFolder, jobName, "state.json")));
    })
    .filter((jobState) => jobState.state !== "done");
