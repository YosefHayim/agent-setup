#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { startDetachedWatcher } from "../../detached-watcher.js";
import { readAgentId } from "../../environment.js";
import { readSessionIdFrom } from "../../session-ids.js";
import { readRehomeAgentFrom } from "../rehome-ledger.js";

const runHandOverEndedSession = (): void => {
  const agentId = readAgentId();
  const agent = readRehomeAgentFrom(agentId);
  const hookDetails: unknown = JSON.parse(readFileSync(0, "utf8"));

  const sessionId = readSessionIdFrom(hookDetails);

  const hasNoAgentOrSession = !agent || !sessionId;
  if (hasNoAgentOrSession) {
    return;
  }

  startDetachedWatcher({
    hookUrl: import.meta.url,
    watcherName: "rehome-watcher",
    watcherArguments: ["--agent", agent, "--session", sessionId, "--wait"],
  });
};

try {
  runHandOverEndedSession();
} catch {
  // Never block or delay the agent's exit.
}
process.exit(0);
