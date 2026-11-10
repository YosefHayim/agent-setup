// Codex lists `codex resume` threads by threads.cwd in ~/.codex/state_<n>.sqlite and resumes them in that folder.
// A full reconcile recomputes cwd from the rollout's last `thread_settings_applied` line, so a move appends such a
// line (append-only: the thread-history index stores byte offsets into the rollout) and then updates the row.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { codexHome } from "../codex-home.js";
import { appendJsonLine, decodeJsonLine, isRecord } from "../json-lines.js";
import { readTranscriptTail } from "../transcript-reader.js";

export type CodexThread = {
  readonly threadId: string;
  readonly rolloutFile: string;
  readonly homeFolder: string;
  readonly title: string;
};

type ThreadRow = {
  readonly threadId: string;
  readonly rolloutFile: string;
  readonly cwd: string;
  readonly title: string;
};

// e.g. "state_5.sqlite" — Codex bumps the number when the schema changes.
const STATE_DATABASE_PATTERN = /^state_(\d+)\.sqlite$/u;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
const BUSY_TIMEOUT_MILLISECONDS = 5_000;

const stateDatabaseFile = (homeRoot: string): string | undefined => {
  const home = codexHome(homeRoot);
  const newest = (existsSync(home) ? readdirSync(home) : [])
    .map((name) => ({ name, version: Number(STATE_DATABASE_PATTERN.exec(name)?.[1] || -1) }))
    .filter((database) => database.version >= 0)
    .sort((left, right) => right.version - left.version)[0];
  return newest ? path.join(home, newest.name) : undefined;
};

// node:sqlite is unflagged from Node 22.13; on an older Node the Codex half of the feature stays off.
const openStateDatabase = async (request: { readonly homeRoot: string; readonly readOnly: boolean }) => {
  const databaseFile = stateDatabaseFile(request.homeRoot);
  if (!databaseFile) {
    return undefined;
  }

  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databaseFile, { readOnly: request.readOnly });
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLISECONDS}`);
  return database;
};

const textColumn = (row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  return typeof value === "string" ? value : "";
};

const decodeThreadRow = (row: Record<string, unknown>): ThreadRow => ({
  threadId: textColumn(row, "id"),
  rolloutFile: textColumn(row, "rollout_path"),
  cwd: textColumn(row, "cwd"),
  title: textColumn(row, "title") || textColumn(row, "first_user_message"),
});

const USER_THREADS_SQL = `
SELECT id, rollout_path, cwd, title, first_user_message FROM threads
WHERE archived = 0 AND (thread_source IS NULL OR thread_source != 'subagent')
  AND id NOT IN (SELECT child_thread_id FROM thread_spawn_edges)`;

export const listCodexThreads = async (homeRoot: string): Promise<ReadonlyArray<CodexThread>> => {
  const database = await openStateDatabase({ homeRoot, readOnly: true });
  if (!database) {
    return [];
  }

  try {
    return database
      .prepare(USER_THREADS_SQL)
      .all()
      .filter(isRecord)
      .map(decodeThreadRow)
      .filter((row) => row.rolloutFile && existsSync(row.rolloutFile))
      .map((row) => ({ threadId: row.threadId, rolloutFile: row.rolloutFile, homeFolder: row.cwd, title: row.title }));
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

const familyOf = async (request: { readonly homeRoot: string; readonly thread: CodexThread }) => {
  const database = await openStateDatabase({ homeRoot: request.homeRoot, readOnly: true });
  if (!database) {
    return [];
  }

  try {
    return database.prepare(DESCENDANTS_SQL).all(request.thread.threadId).filter(isRecord).map(decodeThreadRow);
  } finally {
    database.close();
  }
};

// Each writer holds an flock on thread-writer-locks/<id>.lock (named by thread or rollout segment id) for as long
// as it can append, and lsof sees that open file.
const writerLockHeld = (request: { readonly homeRoot: string; readonly rows: ReadonlyArray<ThreadRow> }): boolean => {
  const lockFiles = [
    ...new Set(
      request.rows.flatMap((row) => [row.threadId, ...(path.basename(row.rolloutFile).match(UUID_PATTERN) || [])]),
    ),
  ]
    .map((lockId) => path.join(codexHome(request.homeRoot), "thread-writer-locks", `${lockId}.lock`))
    .filter(existsSync);
  if (lockFiles.length === 0) {
    return false;
  }

  const lsof = spawnSync("lsof", ["-t", ...lockFiles], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${process.env.PATH || ""}:/usr/sbin:/usr/bin` },
  });
  // Without lsof the lock cannot be ruled out, so the thread counts as live.
  return lsof.error !== undefined || lsof.stdout.trim() !== "";
};

export const codexThreadIsLive = async (request: {
  readonly homeRoot: string;
  readonly thread: CodexThread;
  readonly quietSeconds: number;
}): Promise<boolean> => {
  const ownRow = { threadId: request.thread.threadId, rolloutFile: request.thread.rolloutFile, cwd: "", title: "" };
  const rows = [ownRow, ...(await familyOf(request))];
  const recentlyWritten = rows.some(
    (row) =>
      existsSync(row.rolloutFile) && Date.now() - statSync(row.rolloutFile).mtimeMs < request.quietSeconds * 1_000,
  );
  return recentlyWritten || writerLockHeld({ homeRoot: request.homeRoot, rows });
};

const isSettingsLine = (line: Record<string, unknown>): boolean =>
  isRecord(line.payload) && line.payload.type === "thread_settings_applied" && isRecord(line.payload.thread_settings);

const lastSettingsLine = (rolloutFile: string): Record<string, unknown> | undefined => {
  const fromTail = readTranscriptTail(rolloutFile).map(decodeJsonLine).filter(isSettingsLine).at(-1);
  return fromTail || readFileSync(rolloutFile, "utf8").split("\n").map(decodeJsonLine).filter(isSettingsLine).at(-1);
};

const lastOrdinal = (rolloutFile: string): number | undefined =>
  readTranscriptTail(rolloutFile)
    .map(decodeJsonLine)
    .map((line) => line.ordinal)
    .filter((candidate): candidate is number => typeof candidate === "number")
    .at(-1);

// A resumed writer continues from the rollout's last ordinal, so the copied line takes the next one; legacy rollouts
// carry no ordinals at all.
const rehomedSettingsLine = (request: {
  readonly settingsLine: Record<string, unknown>;
  readonly targetFolder: string;
  readonly ordinal: number | undefined;
}): Record<string, unknown> => {
  const lineContent = isRecord(request.settingsLine.payload) ? request.settingsLine.payload : {};
  const settings = isRecord(lineContent.thread_settings) ? lineContent.thread_settings : {};
  const relocatedSettings = {
    ...settings,
    cwd: request.targetFolder,
    ...(Array.isArray(settings.runtime_workspace_roots) ? { runtime_workspace_roots: [request.targetFolder] } : {}),
  };
  return {
    ...request.settingsLine,
    timestamp: new Date().toISOString(),
    ...(request.ordinal === undefined ? {} : { ordinal: request.ordinal + 1 }),
    payload: { ...lineContent, thread_settings: relocatedSettings },
  };
};

const appendRehomedSettings = (request: { readonly rolloutFile: string; readonly targetFolder: string }) => {
  const settingsLine = existsSync(request.rolloutFile) ? lastSettingsLine(request.rolloutFile) : undefined;
  if (!settingsLine) {
    return;
  }

  const relocated = rehomedSettingsLine({
    settingsLine,
    targetFolder: request.targetFolder,
    ordinal: lastOrdinal(request.rolloutFile),
  });
  appendJsonLine({ file: request.rolloutFile, line: relocated });
};

export const moveCodexThread = async (request: {
  readonly homeRoot: string;
  readonly thread: CodexThread;
  readonly targetFolder: string;
}): Promise<void> => {
  const ownRow = { threadId: request.thread.threadId, rolloutFile: request.thread.rolloutFile, cwd: "", title: "" };
  const rows = [ownRow, ...(await familyOf(request))];
  for (const row of rows) {
    appendRehomedSettings({ rolloutFile: row.rolloutFile, targetFolder: request.targetFolder });
  }

  const database = await openStateDatabase({ homeRoot: request.homeRoot, readOnly: false });
  if (!database) {
    return;
  }

  try {
    const updateCwd = database.prepare("UPDATE threads SET cwd = ? WHERE id = ?");
    database.exec("BEGIN IMMEDIATE");
    for (const row of rows) {
      updateCwd.run(request.targetFolder, row.threadId);
    }
    database.exec("COMMIT");
  } finally {
    database.close();
  }
};

// The packaged binary skips the shell wrappers some terminals put in front of `codex`, which can wait for a TTY.
const codexExecutable = (homeRoot: string): string => {
  const packaged = path.join(codexHome(homeRoot), "packages", "standalone", "current", "bin", "codex");
  return existsSync(packaged) ? packaged : "codex";
};

export type CodexDeletion = { readonly threadId: string; readonly deleted: boolean; readonly detail: string };

// `codex delete --force` removes the rollout, the state rows, and the thread-history rows the way Codex itself does.
// Descendants go first because Codex refuses to delete a thread that still owns subagent threads.
export const deleteCodexThread = async (request: {
  readonly homeRoot: string;
  readonly thread: CodexThread;
}): Promise<ReadonlyArray<CodexDeletion>> => {
  const descendants = (await familyOf(request)).map((row) => row.threadId);
  return [...descendants, request.thread.threadId].map((threadId) => {
    const deletion = spawnSync(codexExecutable(request.homeRoot), ["delete", threadId, "--force"], {
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
