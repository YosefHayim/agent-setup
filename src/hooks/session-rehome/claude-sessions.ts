import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { listUnfinishedClaudeJobStatuses } from "../claude-jobs.js";
import { listClaudeSettingsRoots, readLiveClaudeSessionIds } from "../claude-live-sessions.js";
import { listClaudeScratchRoots } from "../claude-scratch-roots.js";
import { readClaudeConfigFolder } from "../environment.js";
import { appendLine, decodeLine } from "../json-lines.js";
import { readTranscriptHead, readTranscriptTail } from "../transcript-reader.js";

export type ClaudeSession = {
  readonly sessionId: string;
  readonly transcriptFile: string;
  readonly projectFolder: string;
  /** Where the session lives now: the last `relocated` line, else the folder it was started in. */
  readonly homeFolder: string;
};

// e.g. "5cc2fa97-8a4b-4379-b0f0-4141d18275da.jsonl"
const TRANSCRIPT_NAME_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/u;

const readProjectsRoot = (homeRoot: string): string => {
  const settingsRoot = readClaudeConfigFolder() ?? path.join(homeRoot, ".claude");
  return path.join(settingsRoot, "projects");
};

// Matches Claude Code's own folder naming, e.g. "/Users/me/Desktop/Code/vybekiit" → "-Users-me-Desktop-Code-vybekiit".
const readProjectFolder = (request: { readonly homeRoot: string; readonly folder: string }): string =>
  path.join(readProjectsRoot(request.homeRoot), request.folder.replace(/[^A-Za-z0-9-]/gu, "-"));

const readHomeFolder = (transcriptFile: string): string => {
  const relocatedCwd = readTranscriptTail(transcriptFile)
    .map(decodeLine)
    .filter((line) => line.type === "relocated" && typeof line.relocatedCwd === "string")
    .map((line) => String(line.relocatedCwd))
    .at(-1);
  const startCwd = readTranscriptHead(transcriptFile)
    .map(decodeLine)
    .map((line) => line.cwd)
    .find((cwd): cwd is string => typeof cwd === "string");
  return relocatedCwd || startCwd || "";
};

const listSessionsInFolder = (projectFolder: string): ReadonlyArray<ClaudeSession> =>
  readdirSync(projectFolder).flatMap((name) => {
    const sessionId = TRANSCRIPT_NAME_PATTERN.exec(name)?.[1];

    const hasNoSessionId = !sessionId;
    if (hasNoSessionId) {
      return [];
    }

    const transcriptFile = path.join(projectFolder, name);
    return [{ sessionId, transcriptFile, projectFolder, homeFolder: readHomeFolder(transcriptFile) }];
  });

export const listClaudeSessions = (homeRoot: string): ReadonlyArray<ClaudeSession> => {
  const root = readProjectsRoot(homeRoot);

  const isRootMissing = !existsSync(root);
  if (isRootMissing) {
    return [];
  }

  const sessions = readdirSync(root, { withFileTypes: true })
    .filter((line) => line.isDirectory())
    .flatMap((child) => listSessionsInFolder(path.join(root, child.name)));
  const copies = new Map<string, number>();
  for (const session of sessions) {
    copies.set(session.sessionId, (copies.get(session.sessionId) || 0) + 1);
  }
  // `claude --resume` already refuses an id stored in two project folders; moving either copy could lose work.
  return sessions.filter((session) => copies.get(session.sessionId) === 1);
};

// Finds one session by file name alone, without reading every transcript the way a full listing does.
export const findClaudeSession = (request: {
  readonly homeRoot: string;
  readonly sessionId: string;
}): ClaudeSession | undefined => {
  const root = readProjectsRoot(request.homeRoot);

  const isRootPresent = existsSync(root);
  const projectFolders = (isRootPresent ? readdirSync(root) : [])
    .map((name) => path.join(root, name))
    .filter((folder) => existsSync(path.join(folder, `${request.sessionId}.jsonl`)));

  const [projectFolder] = projectFolders;

  const isProjectFolderAmbiguous = !projectFolder || projectFolders.length > 1;
  if (isProjectFolderAmbiguous) {
    return undefined;
  }

  const transcriptFile = path.join(projectFolder, `${request.sessionId}.jsonl`);
  return { sessionId: request.sessionId, transcriptFile, projectFolder, homeFolder: readHomeFolder(transcriptFile) };
};

// A running Claude process holds its session, and an unfinished background job's state.json points at its transcript
// by absolute path, so moving either would break a live owner. Each Claude account keeps both under its own config root.
export const isClaudeSessionLive = (request: {
  readonly homeRoot: string;
  readonly session: ClaudeSession;
  readonly quietSeconds: number;
}): boolean => {
  const heldByProcess = readLiveClaudeSessionIds(request.homeRoot).has(request.session.sessionId);
  const ownedByJob = listUnfinishedClaudeJobStatuses(request.homeRoot).some(
    (jobStatus) => jobStatus.sessionId === request.session.sessionId,
  );
  const recentlyWritten = Date.now() - statSync(request.session.transcriptFile).mtimeMs < request.quietSeconds * 1_000;
  return heldByProcess || ownedByJob || recentlyWritten;
};

export type ClaudeMove =
  | { readonly _tag: "moved"; readonly transcriptFile: string }
  | { readonly _tag: "conflict"; readonly existingFile: string };

// Mirrors Claude Code's own relocateSessionTranscript: move the transcript and its folder, then append the
// `relocated` line whose relocatedCwd tells /resume which project the session now belongs to.
export const moveClaudeSession = (request: {
  readonly homeRoot: string;
  readonly session: ClaudeSession;
  readonly targetFolder: string;
}): ClaudeMove => {
  const targetProjectFolder = readProjectFolder({ homeRoot: request.homeRoot, folder: request.targetFolder });
  const targetTranscript = path.join(targetProjectFolder, path.basename(request.session.transcriptFile));
  const originSessionFolder = path.join(request.session.projectFolder, request.session.sessionId);

  const targetSessionFolder = path.join(targetProjectFolder, request.session.sessionId);

  const hasTargetSession = existsSync(targetTranscript) || existsSync(targetSessionFolder);
  if (hasTargetSession) {
    return { _tag: "conflict", existingFile: targetTranscript };
  }

  mkdirSync(targetProjectFolder, { recursive: true });
  renameSync(request.session.transcriptFile, targetTranscript);
  const relocated = { type: "relocated", sessionId: request.session.sessionId, relocatedCwd: request.targetFolder };
  try {
    const hasOriginSessionFolder = existsSync(originSessionFolder);
    if (hasOriginSessionFolder) {
      renameSync(originSessionFolder, targetSessionFolder);
    }

    appendLine({ file: targetTranscript, line: relocated });
  } catch (moveError) {
    // A half-done move would split the transcript from its subagents; put everything back in the old folder.
    const isTargetOnlySession = existsSync(targetSessionFolder) && !existsSync(originSessionFolder);
    if (isTargetOnlySession) {
      renameSync(targetSessionFolder, originSessionFolder);
    }

    renameSync(targetTranscript, request.session.transcriptFile);
    throw moveError;
  }
  return { _tag: "moved", transcriptFile: targetTranscript };
};

const listScratchFolders = (request: { readonly homeRoot: string; readonly sessionId: string }) =>
  listClaudeScratchRoots(request.homeRoot).flatMap((root) => {
    try {
      return readdirSync(root).map((projectName) => path.join(root, projectName, request.sessionId));
    } catch {
      return [];
    }
  });

// A live Claude process may append between our read and our rename, so a grown file is re-read and filtered again.
// Claude Code keeps the prompt history readable by its owner only, and the rewritten file keeps that mode.
const removeHistoryLines = (request: { readonly historyFile: string; readonly sessionIds: ReadonlySet<string> }) => {
  for (let attempt = 0; attempt < 5 && existsSync(request.historyFile); attempt += 1) {
    const historyBefore = statSync(request.historyFile);
    const keptLines = readFileSync(request.historyFile, "utf8")
      .split("\n")
      .filter((line) => !line.trim() || !request.sessionIds.has(String(decodeLine(line).sessionId)));
    const rewrittenFile = `${request.historyFile}.rehome-${process.pid}`;
    rmSync(rewrittenFile, { force: true });
    writeFileSync(rewrittenFile, keptLines.join("\n"), { mode: historyBefore.mode & 0o777 });

    const isHistoryUnchanged = statSync(request.historyFile).size === historyBefore.size;
    if (isHistoryUnchanged) {
      renameSync(rewrittenFile, request.historyFile);
      return;
    }

    rmSync(rewrittenFile, { force: true });
  }
};

// An account whose projects folder is this one, e.g. ~/.claude-work/projects linked to ~/.claude/projects, keeps files
// for these same sessions. Any other .claude-* folder, a backup for one, holds sessions of its own and is left alone.
const listAccountRootsSharingProjects = (homeRoot: string): ReadonlyArray<string> => {
  const configuredProjects = readProjectsRoot(homeRoot);
  const sharedProjects = realpathSync(configuredProjects);
  return listClaudeSettingsRoots(homeRoot).filter((settingsRoot) => {
    const accountProjects = path.join(settingsRoot, "projects");
    return existsSync(accountProjects) && realpathSync(accountProjects) === sharedProjects;
  });
};

// Each Claude account keeps its own file history, session environment and prompt history under its config root.
export const deleteClaudeSessions = (request: {
  readonly homeRoot: string;
  readonly sessions: ReadonlyArray<ClaudeSession>;
}): void => {
  const settingsRoots = listAccountRootsSharingProjects(request.homeRoot);
  for (const session of request.sessions) {
    const accountFolders = settingsRoots.flatMap((settingsRoot) => [
      path.join(settingsRoot, "file-history", session.sessionId),
      path.join(settingsRoot, "session-env", session.sessionId),
    ]);
    const sessionFolders = [
      path.join(session.projectFolder, session.sessionId),
      ...accountFolders,
      ...listScratchFolders({ homeRoot: request.homeRoot, sessionId: session.sessionId }),
    ];
    for (const removable of [session.transcriptFile, ...sessionFolders]) {
      rmSync(removable, { recursive: true, force: true });
    }
  }
  const sessionIds = new Set(request.sessions.map((session) => session.sessionId));
  for (const claudeFolder of settingsRoots) {
    removeHistoryLines({ historyFile: path.join(claudeFolder, "history.jsonl"), sessionIds });
  }
};

// A deleted repo's project folder also holds its auto-memory; it goes once no session is left in it.
export const removeEmptyProjectFolder = (request: { readonly homeRoot: string; readonly folder: string }): boolean => {
  const projectFolder = readProjectFolder(request);

  const hasNoTranscriptInProject =
    !existsSync(projectFolder) || readdirSync(projectFolder).some((name) => TRANSCRIPT_NAME_PATTERN.test(name));
  if (hasNoTranscriptInProject) {
    return false;
  }

  rmSync(projectFolder, { recursive: true, force: true });
  return true;
};
