export const reportLine = (request: {
  readonly action: string;
  readonly detail: string;
  readonly target: string;
}): string => [request.action.padEnd(12), request.detail.padEnd(24), request.target].join(" ");

// Every target but a tool command is an absolute path, and a path holds no " /", so the last one starts the target.
export const reportTarget = (line: string): string | null => {
  const targetStart = line.lastIndexOf(" /");

  const isTargetMissing = targetStart < 0;
  if (isTargetMissing) {
    return null;
  }

  return line.slice(targetStart + 1);
};
