import { readFileSync } from "node:fs";
import path from "node:path";

import { claudeConfigRoots } from "./claudeLiveSessions.js";
import { folderEntries } from "./folderEntries.js";
import { isRecord } from "./jsonLines.js";

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
// a working, blocked or stopped job can still be resumed. A config root that never ran a background job has no jobs
// folder, and one that cannot be listed throws, since any job could be running.
export const unfinishedClaudeJobStates = (homeRoot: string): ReadonlyArray<Record<string, unknown>> =>
  claudeConfigRoots(homeRoot)
    .flatMap((configRoot) => {
      const jobsFolder = path.join(configRoot, "jobs");
      const jobNames = folderEntries({ folder: jobsFolder, recursive: false });
      return jobNames.flatMap((jobName) => jobStateIn(path.join(jobsFolder, jobName, "state.json")));
    })
    .filter((jobState) => jobState.state !== "done");
