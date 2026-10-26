// e.g. "kept     in-use               /Users/me/Code/app/.worktrees/login"
export const reportLine = (request: {
  readonly action: string;
  readonly detail: string;
  readonly target: string;
}): string => [request.action.padEnd(12), request.detail.padEnd(24), request.target].join(" ");

// Every target but a tool command is an absolute path, and a path holds no " /", so the last one starts the target.
export const reportTarget = (line: string): string | undefined => {
  const targetStart = line.lastIndexOf(" /");
  if (targetStart < 0) {
    return undefined;
  }

  return line.slice(targetStart + 1);
};
