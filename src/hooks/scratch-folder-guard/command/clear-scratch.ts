#!/usr/bin/env node

import { writeSync } from "node:fs";
import os from "node:os";

import { SESSION_ID_PATTERN } from "../../session-ids.js";
import { listEmptyScratchFolder } from "../scratch-removal.js";
import { listAgentScratchFolders } from "../session-scratch.js";

const clearScratch = (): void => {
  const sessionId = process.argv[2] || "";

  const isSessionIdInvalid = !SESSION_ID_PATTERN.test(sessionId);
  if (isSessionIdInvalid) {
    writeSync(2, "usage: clearScratch <session-id>\n");
    process.exitCode = 1;
    return;
  }

  const homeRoot = os.homedir();
  const scratchFolders = listAgentScratchFolders({ homeRoot, sessionId });
  const keptWorkTrees = scratchFolders.flatMap(listEmptyScratchFolder);
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
