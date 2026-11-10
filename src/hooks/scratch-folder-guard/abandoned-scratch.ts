import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

import { liveClaudeSessionIds } from "../claude-live-sessions.js";
import { removeScratchFolders } from "./scratch-removal.js";
import { claudeSessionFolders, codexScratchFolders } from "./session-scratch.js";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
// A Claude Code session that is not running would have lost its folder at a normal exit; the quiet day covers a
// session that none of this machine's registries list.
const CLAUDE_QUIET_MILLISECONDS = DAY_MILLISECONDS;
// Codex keeps no registry of running threads, and a thread can be picked up again days later.
const CODEX_QUIET_MILLISECONDS = 7 * DAY_MILLISECONDS;

const changedSince = (request: { readonly entry: string; readonly cutoff: number }): boolean => {
  const status = lstatSync(request.entry);
  if (status.mtimeMs > request.cutoff) {
    return true;
  }

  return (
    status.isDirectory() &&
    readdirSync(request.entry).some((name) =>
      changedSince({ entry: path.join(request.entry, name), cutoff: request.cutoff }),
    )
  );
};

const quietSince = (request: { readonly folder: string; readonly cutoff: number }): boolean => {
  try {
    return !changedSince({ entry: request.folder, cutoff: request.cutoff });
  } catch {
    // A folder that cannot be read all the way through is left alone.
    return false;
  }
};

// Removes the scratch folders whose session never got to clean up: a Claude Code session that was killed, or a
// Codex thread that was left.
export const removeAbandonedScratch = (homeRoot: string): void => {
  const liveSessionIds = liveClaudeSessionIds(homeRoot);
  const claudeCutoff = Date.now() - CLAUDE_QUIET_MILLISECONDS;
  const codexCutoff = Date.now() - CODEX_QUIET_MILLISECONDS;
  const abandonedClaudeFolders = claudeSessionFolders(homeRoot)
    .filter((folder) => !liveSessionIds.has(path.basename(folder)))
    .filter((folder) => quietSince({ folder, cutoff: claudeCutoff }));
  const abandonedCodexFolders = codexScratchFolders(homeRoot).filter((folder) =>
    quietSince({ folder, cutoff: codexCutoff }),
  );
  removeScratchFolders([...abandonedClaudeFolders, ...abandonedCodexFolders]);
};
