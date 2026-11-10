import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { readCodexHome } from "../codex-home.js";
import { appendLine, decodeLine, isPlainObject } from "../json-lines.js";
import { readTranscriptTail } from "../transcript-reader.js";

export type CodexThread = {
  readonly threadId: string;
  readonly rolloutFile: string;
  readonly homeFolder: string;
  readonly title: string;
};

type StoredThread = {
  readonly threadId: string;
  readonly rolloutFile: string;
  readonly cwd: string;
  readonly title: string;
};

// e.g. "state_5.sqlite" — Codex bumps the number when the schema changes.
const STATUS_DATABASE_PATTERN = /^state_(\d+)\.sqlite$/u;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
const BUSY_TIMEOUT_MILLISECONDS = 5_000;

const readStorageDatabaseFile = (homeRoot: string): string | null => {
  const home = readCodexHome(homeRoot);

  const isCodexHomePresent = existsSync(home);
  const newest = (isCodexHomePresent ? readdirSync(home) : [])
    .map((name) => ({ name, version: Number(STATUS_DATABASE_PATTERN.exec(name)?.[1] || -1) }))
    .filter((database) => database.version >= 0)
    .sort((left, right) => right.version - left.version)[0];

  const isDatabaseFound = newest != null;
  return isDatabaseFound ? path.join(home, newest.name) : null;
};

// node:sqlite is unflagged from Node 22.13; on an older Node the Codex half of the feature stays off.
const openStorageDatabase = async (request: { readonly homeRoot: string; readonly readOnly: boolean }) => {
  const databaseFile = readStorageDatabaseFile(request.homeRoot);

  const hasNoDatabaseFile = !databaseFile;
  if (hasNoDatabaseFile) {
    return null;
  }

  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databaseFile, { readOnly: request.readOnly });
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLISECONDS}`);
  return database;
};

const readStringColumn = (threadFields: Record<string, unknown>, column: string): string => {
  const field = threadFields[column];

  const isStringField = typeof field === "string";
  return isStringField ? field : "";
};

const decodeThread = (threadFields: Record<string, unknown>): StoredThread => ({
  threadId: readStringColumn(threadFields, "id"),
  rolloutFile: readStringColumn(threadFields, "rollout_path"),
  cwd: readStringColumn(threadFields, "cwd"),
  title: readStringColumn(threadFields, "title") || readStringColumn(threadFields, "first_user_message"),
});

const USER_THREADS_SQL = `
SELECT id, rollout_path, cwd, title, first_user_message FROM threads
WHERE archived = 0 AND (thread_source IS NULL OR thread_source != 'subagent')
  AND id NOT IN (SELECT child_thread_id FROM thread_spawn_edges)`;

export const listCodexThreads = async (homeRoot: string): Promise<ReadonlyArray<CodexThread>> => {
  const database = await openStorageDatabase({ homeRoot, readOnly: true });

  const hasNoDatabase = !database;
  if (hasNoDatabase) {
    return [];
  }

  try {
    return database
      .prepare(USER_THREADS_SQL)
      .all()
      .filter(isPlainObject)
      .map(decodeThread)
      .filter((threadFields) => threadFields.rolloutFile && existsSync(threadFields.rolloutFile))
      .map((threadFields) => ({
        threadId: threadFields.threadId,
        rolloutFile: threadFields.rolloutFile,
        homeFolder: threadFields.cwd,
        title: threadFields.title,
      }));
  } finally {
    database.close();
  }
};

// Subagent threads run in their parent's folder, so they move and delete together with it.
const DESCENDANTS_SQL = `
WITH RECURSIVE descendants(id, depth) AS (
  SELECT child_thread_id, 1 FROM thread_spawn_edges WHERE parent_thread_id = ?
  UNION SELECT edge.child_thread_id, descendants.depth + 1
  FROM thread_spawn_edges edge JOIN descendants ON edge.parent_thread_id = descendants.id
)
SELECT threads.id, threads.rollout_path, threads.cwd, threads.title, threads.first_user_message
FROM descendants JOIN threads ON threads.id = descendants.id
ORDER BY descendants.depth DESC`;

const readFamilyOf = async (request: { readonly homeRoot: string; readonly thread: CodexThread }) => {
  const database = await openStorageDatabase({ homeRoot: request.homeRoot, readOnly: true });

  const hasNoDatabase = !database;
  if (hasNoDatabase) {
    return [];
  }

  try {
    return database.prepare(DESCENDANTS_SQL).all(request.thread.threadId).filter(isPlainObject).map(decodeThread);
  } finally {
    database.close();
  }
};

// Each writer holds an flock on thread-writer-locks/<id>.lock (named by thread or rollout segment id) for as long
// as it can append, and lsof sees that open file.
const isWriterLockHeld = (request: {
  readonly homeRoot: string;
  readonly rows: ReadonlyArray<StoredThread>;
}): boolean => {
  const lockFiles = [
    ...new Set(
      request.rows.flatMap((threadFields) => [
        threadFields.threadId,
        ...(path.basename(threadFields.rolloutFile).match(UUID_PATTERN) || []),
      ]),
    ),
  ]
    .map((lockId) => path.join(readCodexHome(request.homeRoot), "thread-writer-locks", `${lockId}.lock`))
    .filter(existsSync);

  const isLockFilesEmpty = lockFiles.length === 0;
  if (isLockFilesEmpty) {
    return false;
  }

  const lsof = spawnSync("lsof", ["-t", ...lockFiles], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${process.env.PATH || ""}:/usr/sbin:/usr/bin` },
  });
  // Without lsof the lock cannot be ruled out, so the thread counts as live.
  return lsof.error != null || lsof.stdout.trim() !== "";
};

export const isCodexThreadLive = async (request: {
  readonly homeRoot: string;
  readonly thread: CodexThread;
  readonly quietSeconds: number;
}): Promise<boolean> => {
  const storedOwn = { threadId: request.thread.threadId, rolloutFile: request.thread.rolloutFile, cwd: "", title: "" };
  const databaseRows = [storedOwn, ...(await readFamilyOf(request))];
  const recentlyWritten = databaseRows.some(
    (threadFields) =>
      existsSync(threadFields.rolloutFile) &&
      Date.now() - statSync(threadFields.rolloutFile).mtimeMs < request.quietSeconds * 1_000,
  );
  return recentlyWritten || isWriterLockHeld({ homeRoot: request.homeRoot, rows: databaseRows });
};

const isSettingsLine = (line: Record<string, unknown>): boolean =>
  isPlainObject(line.payload) &&
  line.payload.type === "thread_settings_applied" &&
  isPlainObject(line.payload.thread_settings);

const readLastSettingsLine = (rolloutFile: string): Record<string, unknown> | null => {
  const fromTail = readTranscriptTail(rolloutFile).map(decodeLine).filter(isSettingsLine).at(-1);
  return (
    fromTail || readFileSync(rolloutFile, "utf8").split("\n").map(decodeLine).filter(isSettingsLine).at(-1) || null
  );
};

const readLastOrdinal = (rolloutFile: string): number | null =>
  readTranscriptTail(rolloutFile)
    .map(decodeLine)
    .map((line) => line.ordinal)
    .filter((candidate): candidate is number => typeof candidate === "number")
    .at(-1) ?? null;

// A resumed writer continues from the rollout's last ordinal, so the copied line takes the next one; legacy rollouts
// carry no ordinals at all.
const readRehomedSettingsLine = (request: {
  readonly settingsLine: Record<string, unknown>;
  readonly targetFolder: string;
  readonly ordinal: number | null;
}): Record<string, unknown> => {
  const lineMessage = isPlainObject(request.settingsLine.payload) ? request.settingsLine.payload : {};
  const settings = isPlainObject(lineMessage.thread_settings) ? lineMessage.thread_settings : {};
  const isRuntimeRootsArray = Array.isArray(settings.runtime_workspace_roots);
  const relocatedSettings = {
    ...settings,
    cwd: request.targetFolder,
    ...(isRuntimeRootsArray ? { runtime_workspace_roots: [request.targetFolder] } : {}),
  };
  const hasOrdinal = request.ordinal != null;
  return {
    ...request.settingsLine,
    timestamp: new Date().toISOString(),
    ...(hasOrdinal ? { ordinal: request.ordinal + 1 } : {}),
    payload: { ...lineMessage, thread_settings: relocatedSettings },
  };
};

const appendRehomedSettings = (request: { readonly rolloutFile: string; readonly targetFolder: string }) => {
  const isRolloutPresent = existsSync(request.rolloutFile);
  const settingsLine = isRolloutPresent ? readLastSettingsLine(request.rolloutFile) : null;

  const hasNoSettingsLine = !settingsLine;
  if (hasNoSettingsLine) {
    return;
  }

  const relocated = readRehomedSettingsLine({
    settingsLine,
    targetFolder: request.targetFolder,
    ordinal: readLastOrdinal(request.rolloutFile),
  });
  appendLine({ file: request.rolloutFile, line: relocated });
};

export const moveCodexThread = async (request: {
  readonly homeRoot: string;
  readonly thread: CodexThread;
  readonly targetFolder: string;
}): Promise<void> => {
  const storedOwn = { threadId: request.thread.threadId, rolloutFile: request.thread.rolloutFile, cwd: "", title: "" };
  const databaseRows = [storedOwn, ...(await readFamilyOf(request))];
  for (const threadFields of databaseRows) {
    appendRehomedSettings({ rolloutFile: threadFields.rolloutFile, targetFolder: request.targetFolder });
  }

  const database = await openStorageDatabase({ homeRoot: request.homeRoot, readOnly: false });

  const hasNoDatabase = !database;
  if (hasNoDatabase) {
    return;
  }

  try {
    const updateCwd = database.prepare("UPDATE threads SET cwd = ? WHERE id = ?");
    database.exec("BEGIN IMMEDIATE");
    for (const threadFields of databaseRows) {
      updateCwd.run(request.targetFolder, threadFields.threadId);
    }
    database.exec("COMMIT");
  } finally {
    database.close();
  }
};

// The packaged binary skips the shell wrappers some terminals put in front of `codex`, which can wait for a TTY.
const readCodexExecutable = (homeRoot: string): string => {
  const packaged = path.join(readCodexHome(homeRoot), "packages", "standalone", "current", "bin", "codex");

  const isPackagedPresent = existsSync(packaged);
  return isPackagedPresent ? packaged : "codex";
};

export type CodexDeletion = { readonly threadId: string; readonly deleted: boolean; readonly detail: string };

// `codex delete --force` removes the rollout, the state rows, and the thread-history rows the way Codex itself does.
// Descendants go first because Codex refuses to delete a thread that still owns subagent threads.
export const deleteCodexThread = async (request: {
  readonly homeRoot: string;
  readonly thread: CodexThread;
}): Promise<ReadonlyArray<CodexDeletion>> => {
  const descendants = (await readFamilyOf(request)).map((threadFields) => threadFields.threadId);
  return [...descendants, request.thread.threadId].map((threadId) => {
    const deletion = spawnSync(readCodexExecutable(request.homeRoot), ["delete", threadId, "--force"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return {
      threadId,
      deleted: deletion.status === 0,
      detail: (deletion.stdout || deletion.stderr || String(deletion.error || "")).trim(),
    };
  });
};
