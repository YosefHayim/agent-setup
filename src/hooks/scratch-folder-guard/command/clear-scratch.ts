#!/usr/bin/env node
// The command the scratch cleanup question names; an agent runs it to delete its own session's scratch files:
//   node clear-scratch.js <session-id>
// It takes a session ID and never a path, so it can only reach that session's scratch folders.

import { writeSync } from "node:fs";
import os from "node:os";

import { SESSION_ID_PATTERN } from "../../lib/session-ids.js";
import { emptyScratchFolder } from "../lib/scratch-removal.js";
import { agentScratchFolders } from "../lib/session-scratch.js";

const clearScratch = (): void => {
  const sessionId = process.argv[2] || "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    writeSync(2, "usage: clearScratch <session-id>\n");
    process.exitCode = 1;
    return;
  }

  const homeRoot = process.env.HOME || os.homedir();
  const scratchFolders = agentScratchFolders({ homeRoot, sessionId });
  const keptWorkTrees = scratchFolders.flatMap(emptyScratchFolder);
  const clearedFolders = scratchFolders.filter((folder) => !keptWorkTrees.includes(folder));
  const clearedLines = clearedFolders.map((folder) => `Cleared ${folder}`);
  const keptLines = keptWorkTrees.map(
    (workTree) =>
      `Kept ${workTree}: it holds git work that is not committed and pushed. Push it, or delete the folder yourself if it is throwaway.`,
  );
  const report = [...clearedLines, ...keptLines].join("\n");
  writeSync(1, `${report || "No scratch folder to clear."}\n`);
};

clearScratch();
