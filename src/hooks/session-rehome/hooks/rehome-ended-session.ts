#!/usr/bin/env node
// SessionEnd hook: hands the ended Claude Code session or Codex thread to a detached rehome watcher and exits at once.
// Fails open.

import { readFileSync } from "node:fs";

import { startDetachedWatcher } from "../../lib/detached-watcher.js";
import { sessionIdFrom } from "../../lib/session-ids.js";
import { rehomeAgentFrom } from "../lib/rehome-ledger.js";

const handOverEndedSession = (): void => {
  const agent = rehomeAgentFrom(process.env.AGENT_SETUP_AGENT_ID);
  const hookInput: unknown = JSON.parse(readFileSync(0, "utf8"));
  const sessionId = sessionIdFrom(hookInput);
  if (!agent || !sessionId) {
    return;
  }

  startDetachedWatcher({
    hookUrl: import.meta.url,
    watcherName: "rehome-watcher",
    watcherArguments: ["--agent", agent, "--session", sessionId, "--wait"],
  });
};

try {
  handOverEndedSession();
} catch {
  // Never block or delay the agent's exit.
}
process.exit(0);
