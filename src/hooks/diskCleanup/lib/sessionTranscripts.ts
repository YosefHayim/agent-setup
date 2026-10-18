import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { claudeConfigRoots } from "../../lib/claudeLiveSessions.js";
import { codexHome } from "../../lib/codexHome.js";
import { createPathMatcher } from "../../lib/pathMatcher.js";
import { readClaudeEvidence, readCodexEvidence } from "../../lib/sessionEvidence.js";

type SessionTranscript = { readonly transcriptFile: string; readonly readEvidence: typeof readClaudeEvidence };

const NO_KEYWORDS = (): ReadonlySet<string> => new Set();

const isMissingFolder = (failure: unknown): boolean =>
  failure instanceof Error && "code" in failure && (failure.code === "ENOENT" || failure.code === "ENOTDIR");

// A folder that is not there has no entries. One that is there but cannot be listed throws.
const entryNames = (request: { readonly folder: string; readonly recursive: boolean }): ReadonlyArray<string> => {
  try {
    return readdirSync(request.folder, { recursive: request.recursive, encoding: "utf8" });
  } catch (failure) {
    if (isMissingFolder(failure)) {
      return [];
    }

    throw failure;
  }
};

const claudeProjectFolders = (homeRoot: string): ReadonlyArray<string> =>
  claudeConfigRoots(homeRoot).flatMap((configRoot) => {
    const projectsFolder = path.join(configRoot, "projects");
    const projectNames = entryNames({ folder: projectsFolder, recursive: false });
    return projectNames.map((projectName) => path.join(projectsFolder, projectName));
  });

// A session's own transcript is <project>/<id>.jsonl, and each of its subagents writes
// <project>/<id>/subagents/<agent>.jsonl.
const claudeTranscriptsIn = (request: { readonly projectFolder: string; readonly sessionId: string }) => {
  const ownTranscript = path.join(request.projectFolder, `${request.sessionId}.jsonl`);
  const subagentsFolder = path.join(request.projectFolder, request.sessionId, "subagents");
  const subagentTranscripts = entryNames({ folder: subagentsFolder, recursive: false })
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(subagentsFolder, name));
  return [ownTranscript, ...subagentTranscripts].filter(existsSync);
};

const claudeTranscriptsOf = (request: { readonly homeRoot: string; readonly sessionIds: ReadonlyArray<string> }) => {
  const projectFolders = claudeProjectFolders(request.homeRoot);
  const transcriptFiles = request.sessionIds.flatMap((sessionId) =>
    projectFolders.flatMap((projectFolder) => claudeTranscriptsIn({ projectFolder, sessionId })),
  );
  return [...new Set(transcriptFiles)];
};

// Rollouts are sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl.
const codexRolloutsOf = (request: { readonly homeRoot: string; readonly threadIds: ReadonlyArray<string> }) => {
  if (request.threadIds.length === 0) {
    return [];
  }

  const sessionsFolder = path.join(codexHome(request.homeRoot), "sessions");
  return entryNames({ folder: sessionsFolder, recursive: true })
    .filter((name) => name.endsWith(".jsonl") && request.threadIds.some((threadId) => name.includes(threadId)))
    .map((name) => path.join(sessionsFolder, name));
};

// The named sessions' transcripts, or undefined when a folder that could hold one cannot be listed.
export const sessionTranscripts = (request: {
  readonly homeRoot: string;
  readonly claudeSessionIds: ReadonlyArray<string>;
  readonly codexThreadIds: ReadonlyArray<string>;
}): ReadonlyArray<SessionTranscript> | undefined => {
  try {
    const claudeTranscripts = claudeTranscriptsOf({ homeRoot: request.homeRoot, sessionIds: request.claudeSessionIds });
    const codexRollouts = codexRolloutsOf({ homeRoot: request.homeRoot, threadIds: request.codexThreadIds });
    return [
      ...claudeTranscripts.map((transcriptFile) => ({ transcriptFile, readEvidence: readClaudeEvidence })),
      ...codexRollouts.map((transcriptFile) => ({ transcriptFile, readEvidence: readCodexEvidence })),
    ];
  } catch {
    return undefined;
  }
};

// The folders a transcript's commands, edits, and working folders name, or undefined when it cannot be read.
export const foldersNamedIn = (request: {
  readonly transcript: SessionTranscript;
  readonly folders: ReadonlyArray<string>;
  readonly homeRoot: string;
}): ReadonlyArray<string> | undefined => {
  const namedFolders = request.folders.map((folder) => ({ name: folder, root: folder }));
  const matchers = { matchPaths: createPathMatcher(namedFolders), matchKeywords: NO_KEYWORDS };
  const { transcriptFile, readEvidence } = request.transcript;
  try {
    const evidence = readEvidence({ transcriptFile, matchers, homeRoot: request.homeRoot });
    return [...evidence.pathHits.keys()];
  } catch {
    return undefined;
  }
};
