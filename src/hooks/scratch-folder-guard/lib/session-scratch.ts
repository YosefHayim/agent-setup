import { readdirSync } from "node:fs";
import path from "node:path";

import { claudeScratchRoots } from "../../lib/claude-scratch-roots.js";
import { codexHome } from "../../lib/codex-home.js";
import { SESSION_ID_PATTERN } from "../../lib/session-ids.js";

// Codex has no scratch folder of its own; a thread told to use "the session scratchpad" makes one under these names.
const CODEX_SCRATCH_NAMES = ["scratch", "scratchpad", "scratchpads"];

const foldersIn = (folder: string): ReadonlyArray<string> => {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(folder, entry.name));
  } catch {
    // A scratch root that no agent has used yet does not exist.
    return [];
  }
};

// Every <scratch root>/<project>/<session> folder; each holds the agent's scratchpad/ and the harness's tasks/.
export const claudeSessionFolders = (homeRoot: string): ReadonlyArray<string> =>
  claudeScratchRoots(homeRoot)
    .flatMap(foldersIn)
    .flatMap(foldersIn)
    .filter((folder) => SESSION_ID_PATTERN.test(path.basename(folder)));

// A folder is named after its thread, or after whatever the agent chose, e.g. "oly-canonical-20261006".
export const codexScratchFolders = (homeRoot: string): ReadonlyArray<string> => {
  const codexFolder = codexHome(homeRoot);
  return CODEX_SCRATCH_NAMES.map((name) => path.join(codexFolder, name)).flatMap(foldersIn);
};

// The folders one session's agent writes its own scratch files to. Claude Code's tasks/ is left out: the harness
// keeps its command output there.
export const agentScratchFolders = (request: {
  readonly homeRoot: string;
  readonly sessionId: string;
}): ReadonlyArray<string> => {
  const claudeScratchpads = claudeSessionFolders(request.homeRoot)
    .filter((sessionFolder) => path.basename(sessionFolder) === request.sessionId)
    .flatMap(foldersIn)
    .filter((folder) => path.basename(folder) === "scratchpad");
  const codexThreadFolders = codexScratchFolders(request.homeRoot).filter(
    (folder) => path.basename(folder) === request.sessionId,
  );
  return [...claudeScratchpads, ...codexThreadFolders];
};

export const holdsFiles = (folder: string): boolean =>
  readdirSync(folder, { withFileTypes: true }).some(
    (entry) => !entry.isDirectory() || holdsFiles(path.join(folder, entry.name)),
  );
