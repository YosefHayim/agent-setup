import path from "node:path";

// Claude Code keeps each session's scratchpad and task output in
// <CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>/<project>/<session>. A process that Claude Code did not start lacks the
// variable, so the config root's own tmp folder, a common value for it, is tried as well.
export const claudeScratchRoots = (homeRoot: string): ReadonlyArray<string> => {
  const userId = process.getuid?.();
  if (userId === undefined) {
    return [];
  }

  const configRoot = process.env.CLAUDE_CONFIG_DIR || path.join(homeRoot, ".claude");
  const scratchParents = [process.env.CLAUDE_CODE_TMPDIR || "/tmp", path.join(configRoot, "tmp")];
  const scratchRoots = scratchParents.map((parent) => path.join(parent, `claude-${userId}`));
  return [...new Set(scratchRoots)];
};
