import path from "node:path";
import { readClaudeCodeTmpFolder, readClaudeConfigFolder } from "./environment.js";

// Claude Code keeps each session's scratchpad and task output in
// <CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>/<project>/<session>. A process that Claude Code did not start lacks the
// variable, so the config root's own tmp folder, a common value for it, is tried as well.
export const listClaudeScratchRoots = (homeRoot: string): ReadonlyArray<string> => {
  const userId = process.getuid?.();

  const isUserIdMissing = userId == null;
  if (isUserIdMissing) {
    return [];
  }

  const settingsRoot = readClaudeConfigFolder() ?? path.join(homeRoot, ".claude");
  const scratchParents = [readClaudeCodeTmpFolder() ?? "/tmp", path.join(settingsRoot, "tmp")];
  const scratchRoots = scratchParents.map((parent) => path.join(parent, `claude-${userId}`));
  return [...new Set(scratchRoots)];
};
