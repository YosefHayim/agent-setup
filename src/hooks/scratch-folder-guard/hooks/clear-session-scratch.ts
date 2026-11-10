#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { startDetachedWatcher } from "../../detached-watcher.js";
import { readSessionIdFrom } from "../../session-ids.js";

const runHandOverEndedSession = (): void => {
  const hookDetails: unknown = JSON.parse(readFileSync(0, "utf8"));

  const endedSessionId = readSessionIdFrom(hookDetails);

  const hasNoEndedSessionId = !endedSessionId;
  if (hasNoEndedSessionId) {
    return;
  }

  startDetachedWatcher({
    hookUrl: import.meta.url,
    watcherName: "scratch-watcher",
    watcherArguments: [endedSessionId],
  });
};

try {
  runHandOverEndedSession();
} catch {
  // Never block or delay the agent's exit.
}
process.exit(0);
