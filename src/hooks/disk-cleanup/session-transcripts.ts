import { existsSync } from "node:fs";
import path from "node:path";

import { listClaudeSettingsRoots } from "../claude-live-sessions.js";
import { readCodexHome } from "../codex-home.js";
import { listFolderNames } from "../folder-entries.js";
import { createPathMatcher } from "../path-matcher.js";
import { readClaudeEvidence, readCodexEvidence } from "../session-evidence.js";
import { type FolderPaths, readFolderPaths } from "./folder-paths.js";

type SessionTranscript = { readonly transcriptFile: string; readonly readEvidence: typeof readClaudeEvidence };

const NO_KEYWORDS = (): ReadonlySet<string> => new Set();

const listClaudeProjectFolders = (homeRoot: string): ReadonlyArray<string> =>
  listClaudeSettingsRoots(homeRoot).flatMap((settingsRoot) => {
    const projectsFolder = path.join(settingsRoot, "projects");
    const projectNames = listFolderNames({ folder: projectsFolder, recursive: false });
    return projectNames.map((projectName) => path.join(projectsFolder, projectName));
  });

// A session's own transcript is <project>/<id>.jsonl, and each of its subagents writes
// <project>/<id>/subagents/<agent>.jsonl.
const listClaudeTranscriptsIn = (request: { readonly projectFolder: string; readonly sessionId: string }) => {
  const ownTranscript = path.join(request.projectFolder, `${request.sessionId}.jsonl`);
  const subagentsFolder = path.join(request.projectFolder, request.sessionId, "subagents");
  const subagentTranscripts = listFolderNames({ folder: subagentsFolder, recursive: false })
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(subagentsFolder, name));
  return [ownTranscript, ...subagentTranscripts].filter(existsSync);
};

const listClaudeTranscripts = (request: { readonly homeRoot: string; readonly sessionIds: ReadonlyArray<string> }) => {
  const projectFolders = listClaudeProjectFolders(request.homeRoot);
  const transcriptFiles = request.sessionIds.flatMap((sessionId) =>
    projectFolders.flatMap((projectFolder) => listClaudeTranscriptsIn({ projectFolder, sessionId })),
  );
  return [...new Set(transcriptFiles)];
};

// Rollouts are sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl.
const listCodexRollouts = (request: { readonly homeRoot: string; readonly threadIds: ReadonlyArray<string> }) => {
  const isRequestThreadIdsEmpty = request.threadIds.length === 0;
  if (isRequestThreadIdsEmpty) {
    return [];
  }

  const sessionsFolder = path.join(readCodexHome(request.homeRoot), "sessions");
  return listFolderNames({ folder: sessionsFolder, recursive: true })
    .filter((name) => name.endsWith(".jsonl") && request.threadIds.some((threadId) => name.includes(threadId)))
    .map((name) => path.join(sessionsFolder, name));
};

// The named sessions' transcripts, or undefined when a folder that could hold one cannot be listed.
export const readSessionTranscripts = (request: {
  readonly homeRoot: string;
  readonly claudeSessionIds: ReadonlyArray<string>;
  readonly codexThreadIds: ReadonlyArray<string>;
}): ReadonlyArray<SessionTranscript> | undefined => {
  try {
    const claudeTranscripts = listClaudeTranscripts({
      homeRoot: request.homeRoot,
      sessionIds: request.claudeSessionIds,
    });
    const codexRollouts = listCodexRollouts({ homeRoot: request.homeRoot, threadIds: request.codexThreadIds });
    return [
      ...claudeTranscripts.map((transcriptFile) => ({ transcriptFile, readEvidence: readClaudeEvidence })),
      ...codexRollouts.map((transcriptFile) => ({ transcriptFile, readEvidence: readCodexEvidence })),
    ];
  } catch {
    return undefined;
  }
};

// The folders a transcript's commands, edits, and working folders name by either of their paths, or undefined when it
// cannot be read.
export const readFoldersNamedIn = (request: {
  readonly transcript: SessionTranscript;
  readonly folders: ReadonlyArray<FolderPaths>;
  readonly homeRoot: string;
}): ReadonlyArray<string> | undefined => {
  const namedFolders = request.folders.flatMap(({ folder, paths }) => paths.map((root) => ({ name: folder, root })));
  const matchers = { matchPaths: createPathMatcher(namedFolders), matchKeywords: NO_KEYWORDS };
  const { transcriptFile, readEvidence } = request.transcript;
  try {
    const evidence = readEvidence({ transcriptFile, matchers, homeRoot: request.homeRoot });
    return [...evidence.pathHits.keys()];
  } catch {
    return undefined;
  }
};

// A session owns the folders its transcripts name: the ones it created or worked in. One whose transcripts cannot be
// read owns none, and a manual pass, which names no session, looks at every folder.
export const listFoldersOwnedBy = (request: {
  readonly homeRoot: string;
  readonly endedSessionId: string;
  readonly folders: ReadonlyArray<string>;
  readonly roots: ReadonlyArray<string>;
}): ReadonlyArray<string> => {
  const hasNothingToSearch = !request.endedSessionId || request.folders.length === 0;
  if (hasNothingToSearch) {
    return request.folders;
  }

  const sessionIds = [request.endedSessionId];
  const transcripts =
    readSessionTranscripts({ homeRoot: request.homeRoot, claudeSessionIds: sessionIds, codexThreadIds: sessionIds }) ||
    [];
  const ownedPaths = request.folders.map((folder) => readFolderPaths({ folder, roots: request.roots }));
  const namedFolders = transcripts.flatMap(
    (transcript) => readFoldersNamedIn({ transcript, folders: ownedPaths, homeRoot: request.homeRoot }) || [],
  );
  return request.folders.filter((folder) => namedFolders.includes(folder));
};
