import { readdirSync } from "node:fs";
import path from "node:path";

import { listClaudeScratchRoots } from "../claude-scratch-roots.js";
import { readCodexHome } from "../codex-home.js";
import { SESSION_ID_PATTERN } from "../session-ids.js";

// Codex has no scratch folder of its own; a thread told to use "the session scratchpad" makes one under these names.
const CODEX_SCRATCH_NAMES = ["scratch", "scratchpad", "scratchpads"];

const listFoldersIn = (folder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((line) => line.isDirectory())
      .map((child) => path.join(folder, child.name));
  } catch {
    // A scratch root that no agent has used yet does not exist.
    return [];
  }
};

// Every <scratch root>/<project>/<session> folder; each holds the agent's scratchpad/ and the harness's tasks/.
export const listClaudeSessionFolders = (homeRoot: string): ReadonlyArray<string> =>
  listClaudeScratchRoots(homeRoot)
    .flatMap(listFoldersIn)
    .flatMap(listFoldersIn)
    .filter((folder) => SESSION_ID_PATTERN.test(path.basename(folder)));

// A folder is named after its thread, or after whatever the agent chose, e.g. "oly-canonical-20261006".
export const listCodexScratchFolders = (homeRoot: string): ReadonlyArray<string> => {
  const codexFolder = readCodexHome(homeRoot);
  return CODEX_SCRATCH_NAMES.map((name) => path.join(codexFolder, name)).flatMap(listFoldersIn);
};

// The folders one session's agent writes its own scratch files to. Claude Code's tasks/ is left out: the harness
// keeps its command output there.
export const listAgentScratchFolders = (request: {
  readonly homeRoot: string;
  readonly sessionId: string;
}): ReadonlyArray<string> => {
  const claudeScratchpads = listClaudeSessionFolders(request.homeRoot)
    .filter((sessionFolder) => path.basename(sessionFolder) === request.sessionId)
    .flatMap(listFoldersIn)
    .filter((folder) => path.basename(folder) === "scratchpad");
  const codexThreadFolders = listCodexScratchFolders(request.homeRoot).filter(
    (folder) => path.basename(folder) === request.sessionId,
  );
  return [...claudeScratchpads, ...codexThreadFolders];
};

export const hasFiles = (folder: string): boolean =>
  readdirSync(folder, { withFileTypes: true }).some(
    (line) => !line.isDirectory() || hasFiles(path.join(folder, line.name)),
  );
