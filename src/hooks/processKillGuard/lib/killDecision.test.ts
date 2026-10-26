import { describe, expect, it } from "vitest";

import { decideKill } from "./killDecision.js";
import { killTargetsIn } from "./killTargets.js";
import type { RunningProcess } from "./processTable.js";

const sessionProcessId = 32935;
const processes: ReadonlyArray<RunningProcess> = [
  {
    processId: 22426,
    parentProcessId: 1,
    name: "cmux",
    commandLine: "/Applications/cmux.app/Contents/MacOS/cmux",
  },
  { processId: 30001, parentProcessId: 22426, name: "zsh", commandLine: "-zsh" },
  {
    processId: sessionProcessId,
    parentProcessId: 30001,
    name: "claude",
    commandLine: '/Users/me/.local/bin/claude --settings {"preferredNotifChannel":"notifications_disabled"}',
  },
  {
    processId: 41000,
    parentProcessId: 1,
    name: "Google Chrome",
    commandLine: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
  {
    processId: 52000,
    parentProcessId: sessionProcessId,
    name: "node",
    commandLine: "node /repo/node_modules/.bin/wrangler dev",
  },
];

const decide = (command: string) =>
  decideKill({ killTargets: killTargetsIn(command), processes, claudeProcessIds: new Set([sessionProcessId]) });

describe("decideKill", () => {
  it("denies pkill -f cat and names the session, its terminal, and the apps it would stop", () => {
    const decision = decide('pkill -f "cat"');

    expect(decision._tag).toBe("deny");
    expect(decision).toMatchObject({
      reason: expect.stringContaining(`Claude Code sessions (pid ${sessionProcessId})`),
    });
    expect(decision).toMatchObject({ reason: expect.stringContaining("(cmux)") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("(Google Chrome)") });
  });

  it("allows pkill -f wrangler, which matches only the dev server the agent started", () => {
    expect(decide("pkill -f wrangler")).toEqual({ _tag: "allow" });
  });

  it("allows a kill that names the app it stops", () => {
    expect(decide("pkill -f 'Google Chrome'")).toEqual({ _tag: "allow" });
    expect(decide("pkill -if chrome")).toEqual({ _tag: "allow" });
  });

  it("denies a kill of the terminal even when the pattern names it", () => {
    expect(decide("killall cmux")._tag).toBe("deny");
  });

  it("denies an inverted pattern, which matches everything else", () => {
    expect(decide("pkill -v -f wrangler")._tag).toBe("deny");
  });

  it("denies a pgrep that feeds kill the same way as pkill", () => {
    expect(decide("kill -9 $(pgrep -f notifications)")._tag).toBe("deny");
  });
});
