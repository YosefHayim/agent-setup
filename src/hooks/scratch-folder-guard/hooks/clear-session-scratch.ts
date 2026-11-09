#!/usr/bin/env node
// SessionEnd hook: hands the ended session to a detached scratch watcher and exits at once, because deleting a large
// scratch folder takes longer than the agent waits. Fails open.

import { readFileSync } from "node:fs";

import { startDetachedWatcher } from "../../lib/detached-watcher.js";
import { sessionIdFrom } from "../../lib/session-ids.js";

const handOverEndedSession = (): void => {
  const hookInput: unknown = JSON.parse(readFileSync(0, "utf8"));
  const endedSessionId = sessionIdFrom(hookInput);
  if (!endedSessionId) {
    return;
  }

  startDetachedWatcher({
    hookUrl: import.meta.url,
    watcherName: "scratch-watcher",
    watcherArguments: [endedSessionId],
  });
};

try {
  handOverEndedSession();
} catch {
  // Never block or delay the agent's exit.
}
process.exit(0);
