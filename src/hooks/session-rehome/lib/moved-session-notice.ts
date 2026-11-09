// Pure policy: what a resumed session tells the user (and Claude) when session-rehome moved it.

import type { LedgerEntry } from "./rehome-ledger.js";

export type MovedSessionNotice = { readonly userMessage: string; readonly agentContext: string };

const isInside = (request: { readonly folder: string; readonly root: string }): boolean =>
  request.folder === request.root || request.folder.startsWith(`${request.root}/`);

// e.g. "/Users/me/Desktop/Code" → "~/Desktop/Code"
const shortFolder = (request: { readonly folder: string; readonly homeRoot: string }): string =>
  isInside({ folder: request.folder, root: request.homeRoot })
    ? `~${request.folder.slice(request.homeRoot.length)}`
    : request.folder;

// Claude Code resumes a moved session from any folder without saying so, so it is told whenever it resumes from
// outside the new home. Codex already switches to the new folder on resume, so it hears about each move once.
export const movedSessionNotice = (request: {
  readonly entry: LedgerEntry;
  readonly cwd: string;
  readonly homeRoot: string;
}): MovedSessionNotice | undefined => {
  const { entry } = request;
  const movedOn = entry.decidedAt.slice(0, 10);
  const from = shortFolder({ folder: entry.fromFolder, homeRoot: request.homeRoot });
  const to = shortFolder({ folder: entry.toFolder, homeRoot: request.homeRoot });
  if (entry.decision !== "moved") {
    return undefined;
  }

  if (entry.agent === "codex") {
    return entry.notifiedAt
      ? undefined
      : {
          userMessage: `Session moved to ${entry.repoName} on ${movedOn} (from ${from}). It now runs in ${to}, and \`codex resume\` lists it there.`,
          agentContext: "",
        };
  }

  return isInside({ folder: request.cwd, root: entry.toFolder })
    ? undefined
    : {
        userMessage: `Session moved to ${entry.repoName} on ${movedOn} (from ${from}). It now lives in ${to}; next time resume it there: cd ${to} && claude --resume ${entry.sessionId}`,
        agentContext: `session-rehome moved this session to the ${entry.repoName} repo at ${entry.toFolder}. The shell still starts in ${request.cwd}, so work in ${entry.toFolder}.`,
      };
};
