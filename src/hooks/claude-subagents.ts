import { readFileSync } from "node:fs";
import path from "node:path";

import { listClaudeSettingsRoots } from "./claude-live-sessions.js";
import { listFolderNames } from "./folder-entries.js";
import { isPlainObject } from "./json-lines.js";
import { decodeTranscriptLine, readTranscriptTail } from "./transcript-reader.js";

const isMarkedFinished = (metaFile: string): boolean => {
  try {
    const subagentMeta: unknown = JSON.parse(readFileSync(metaFile, "utf8"));
    return isPlainObject(subagentMeta) && subagentMeta.finished === true;
  } catch {
    // Claude Code rewrites the file while the subagent runs, so it can be half-written while it is read.
    return false;
  }
};

// A subagent that stopped ended its last turn; one cut off mid-run is still waiting on a tool, never got to answer, or
// left a turn with no stop reason written yet. A folder kept by mistake still goes once it sits unchanged for a day.
const isCutOffMidRun = (transcriptFile: string): boolean => {
  const assistantTurns = readTranscriptTail(transcriptFile)
    .map(decodeTranscriptLine)
    .filter((line) => line?.type === "assistant");
  const lastTurn = assistantTurns.at(-1);
  return lastTurn?.stopReason !== "end_turn";
};

const isRunning = (metaFile: string): boolean => {
  if (isMarkedFinished(metaFile)) {
    return false;
  }

  const transcriptFile = metaFile.replace(/\.meta\.json$/u, ".jsonl");
  return isCutOffMidRun(transcriptFile);
};

const listSubagentMetaFilesIn = (request: { readonly configRoot: string; readonly sessionId: string }) => {
  const projectsFolder = path.join(request.configRoot, "projects");
  const subagentFolders = listFolderNames({ folder: projectsFolder, recursive: false }).map((projectName) =>
    path.join(projectsFolder, projectName, request.sessionId, "subagents"),
  );
  return subagentFolders.flatMap((subagentFolder) =>
    listFolderNames({ folder: subagentFolder, recursive: false })
      .filter((name) => name.endsWith(".meta.json"))
      .map((name) => path.join(subagentFolder, name)),
  );
};

// Claude Code keeps each subagent at <config root>/projects/<project>/<session>/subagents/agent-<id>.jsonl, beside an
// agent-<id>.meta.json. The meta file says "finished" for only some of the subagents that ended, so the transcript
// decides the rest. A folder that cannot be listed throws, since any subagent in it could be running.
export const hasRunningSubagents = (request: { readonly homeRoot: string; readonly sessionId: string }): boolean =>
  listClaudeSettingsRoots(request.homeRoot)
    .flatMap((settingsRoot) => listSubagentMetaFilesIn({ configRoot: settingsRoot, sessionId: request.sessionId }))
    .some(isRunning);
