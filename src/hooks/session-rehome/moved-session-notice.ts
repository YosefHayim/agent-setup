import type { LedgerLine } from "./rehome-ledger.js";

export type MovedSessionNotice = { readonly userMessage: string; readonly agentContext: string };

const isInside = (request: { readonly folder: string; readonly root: string }): boolean =>
  request.folder === request.root || request.folder.startsWith(`${request.root}/`);

// e.g. "/Users/me/Desktop/Code" → "~/Desktop/Code"
const readShortFolder = (request: { readonly folder: string; readonly homeRoot: string }): string =>
  isInside({ folder: request.folder, root: request.homeRoot })
    ? `~${request.folder.slice(request.homeRoot.length)}`
    : request.folder;

// Claude Code resumes a moved session from any folder without saying so, so it is told whenever it resumes from
// outside the new home. Codex already switches to the new folder on resume, so it hears about each move once.
export const readMovedSessionNotice = (request: {
  readonly entry: LedgerLine;
  readonly cwd: string;
  readonly homeRoot: string;
}): MovedSessionNotice | null => {
  const { entry: line } = request;
  const movedOn = line.decidedAt.slice(0, 10);
  const from = readShortFolder({ folder: line.fromFolder, homeRoot: request.homeRoot });
  const to = readShortFolder({ folder: line.toFolder, homeRoot: request.homeRoot });

  const isNotMovedDecision = line.decision !== "moved";
  if (isNotMovedDecision) {
    return null;
  }

  const isCodexAgent = line.agent === "codex";
  if (isCodexAgent) {
    const isAlreadyNotified = line.notifiedAt !== "";
    return isAlreadyNotified
      ? null
      : {
          userMessage: `Session moved to ${line.repoName} on ${movedOn} (from ${from}). It now runs in ${to}, and \`codex resume\` lists it there.`,
          agentContext: "",
        };
  }

  return isInside({ folder: request.cwd, root: line.toFolder })
    ? null
    : {
        userMessage: `Session moved to ${line.repoName} on ${movedOn} (from ${from}). It now lives in ${to}; next time resume it there: cd ${to} && claude --resume ${line.sessionId}`,
        agentContext: `session-rehome moved this session to the ${line.repoName} repo at ${line.toFolder}. The shell still starts in ${request.cwd}, so work in ${line.toFolder}.`,
      };
};
