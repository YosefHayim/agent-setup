#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { startDetachedWatcher } from "../../detached-watcher.js";
import { readSessionIdFrom } from "../../session-ids.js";

// Grok's session IDs are not UUIDs and its transcripts are never read, so its sessions own no worktree: its watcher
// only gives the caches their daily look.
const listWatcherArguments = (endedSessionId: string): ReadonlyArray<string> => {
  const hasEndedSessionId = endedSessionId !== "";
  return hasEndedSessionId ? ["--session", endedSessionId, "--wait"] : ["--caches-only"];
};

const runHandOverEndedSession = (): void => {
  const hookDetails: unknown = JSON.parse(readFileSync(0, "utf8"));
  const endedSessionId = readSessionIdFrom(hookDetails);
  const watcherArguments = listWatcherArguments(endedSessionId);
  startDetachedWatcher({ hookUrl: import.meta.url, watcherName: "cleanup-watcher", watcherArguments });
};

try {
  runHandOverEndedSession();
} catch {
  // Never block or delay the agent's exit.
}
process.exit(0);
