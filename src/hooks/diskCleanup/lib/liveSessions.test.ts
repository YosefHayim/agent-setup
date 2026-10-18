import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isSessionLive } from "./liveSessions.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const endedThreadId = "019a2c41-7d3e-7b10-9c2a-5e4f6a7b8c9d";
const otherThreadId = "01a13541-9cdb-7102-ae3f-4e1524b54b81";
const workspaces: Array<string> = [];

type CodexHome = { readonly homeRoot: string; readonly lockFolder: string; readonly lsofCallsFile: string };

// A fake home whose stub lsof comes first on PATH.
const createCodexHome = (): CodexHome => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-live-sessions-"));
  workspaces.push(homeRoot);
  const lockFolder = path.join(homeRoot, ".codex", "thread-writer-locks");
  const stubsFolder = path.join(homeRoot, "stub-tools");
  mkdirSync(lockFolder, { recursive: true });
  mkdirSync(stubsFolder);
  vi.stubEnv("CODEX_HOME", path.join(homeRoot, ".codex"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(homeRoot, ".claude"));
  vi.stubEnv("PATH", `${stubsFolder}:${process.env.PATH}`);
  return { homeRoot, lockFolder, lsofCallsFile: path.join(homeRoot, "lsof-calls.log") };
};

const writeLockFile = (request: { readonly home: CodexHome; readonly threadId: string }): string => {
  const lockFile = path.join(request.home.lockFolder, `${request.threadId}.lock`);
  writeFileSync(lockFile, "");
  return realpathSync(lockFile);
};

// The stub logs each call and lists the given files as open in one process, the way lsof -Fn does.
const writeLsofStub = (request: { readonly home: CodexHome; readonly openFiles: ReadonlyArray<string> }) => {
  const stub = path.join(request.home.homeRoot, "stub-tools", "lsof");
  const listing = ["p1", ...request.openFiles.map((file) => `n${file}`)].join("\n");
  writeFileSync(stub, `#!/bin/sh\necho called >> "${request.home.lsofCallsFile}"\ncat <<'LIST'\n${listing}\nLIST\n`);
  chmodSync(stub, 0o755);
};

const lsofCallCount = (home: CodexHome): number =>
  existsSync(home.lsofCallsFile) ? readFileSync(home.lsofCallsFile, "utf8").trim().split("\n").length : 0;

afterEach(() => {
  vi.unstubAllEnvs();
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("isSessionLive", () => {
  it("never lists open files for a session without a Codex lock of its own, whatever other locks exist", () => {
    const home = createCodexHome();
    const otherLock = writeLockFile({ home, threadId: otherThreadId });
    writeLsofStub({ home, openFiles: [otherLock] });

    expect(isSessionLive({ homeRoot: home.homeRoot, sessionId: endedThreadId })).toBe(false);
    expect(lsofCallCount(home)).toBe(0);
  });

  it("counts a Codex session live while a process holds its lock, and ended once none does", () => {
    const home = createCodexHome();
    const ownLock = writeLockFile({ home, threadId: endedThreadId });
    writeLsofStub({ home, openFiles: [ownLock] });
    const isLiveWhileHeld = isSessionLive({ homeRoot: home.homeRoot, sessionId: endedThreadId });
    writeLsofStub({ home, openFiles: [] });
    const isLiveAfterRelease = isSessionLive({ homeRoot: home.homeRoot, sessionId: endedThreadId });

    expect(isLiveWhileHeld).toBe(true);
    expect(isLiveAfterRelease).toBe(false);
  });
});
