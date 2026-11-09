import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./announce-moved-session.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(hookPath), "../../../..");
const sessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const workspaces: Array<string> = [];

const movedEntry = (agent: string) => ({
  agent,
  sessionId,
  decision: "moved",
  title: "fix the checkout",
  fromFolder: "/Users/me/Desktop/Code",
  toFolder: "/Users/me/Desktop/Code/vybekiit",
  repoName: "vybekiit",
  share: 0.9,
  decidedAt: "2026-10-02T08:00:00.000Z",
  notifiedAt: "",
});

const createStateFolder = (ledgerEntries: ReadonlyArray<object>) => {
  const stateFolder = mkdtempSync(path.join(packageRoot, "scratch-rehome-notice-"));
  workspaces.push(stateFolder);
  mkdirSync(stateFolder, { recursive: true });
  // A fresh sweep stamp keeps the hook from starting a background sweep during the test.
  writeFileSync(path.join(stateFolder, "last-sweep"), "");
  writeFileSync(
    path.join(stateFolder, "ledger.jsonl"),
    ledgerEntries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
  );
  return stateFolder;
};

const runHook = (request: {
  readonly stateFolder: string;
  readonly agent: string;
  readonly cwd: string;
  readonly source: string;
}) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    cwd: packageRoot,
    input: JSON.stringify({ session_id: sessionId, source: request.source, cwd: request.cwd }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: "/Users/me",
      AGENT_SETUP_AGENT_ID: request.agent,
      AGENT_SETUP_REHOME_STATE_DIR: request.stateFolder,
    },
  });

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("announceMovedSession process boundary", () => {
  it("tells Claude Code and the user where a session went when it is resumed from its old folder", () => {
    const stateFolder = createStateFolder([movedEntry("claude-code")]);

    const execution = runHook({ stateFolder, agent: "claude-code", cwd: "/Users/me/Desktop/Code", source: "resume" });

    const notice = JSON.parse(execution.stdout);
    expect(notice.systemMessage).toContain("Session moved to vybekiit");
    expect(notice.systemMessage).toContain(`cd ~/Desktop/Code/vybekiit && claude --resume ${sessionId}`);
    expect(notice.hookSpecificOutput).toMatchObject({ hookEventName: "SessionStart" });
  });

  it("stays quiet when the session is resumed from its new home or started fresh", () => {
    const stateFolder = createStateFolder([movedEntry("claude-code")]);

    const fromNewHome = runHook({
      stateFolder,
      agent: "claude-code",
      cwd: "/Users/me/Desktop/Code/vybekiit",
      source: "resume",
    });
    const freshStart = runHook({ stateFolder, agent: "claude-code", cwd: "/Users/me/Desktop/Code", source: "startup" });

    expect(fromNewHome.stdout).toBe("");
    expect(freshStart.stdout).toBe("");
  });

  it("still names the move after the session was later kept in its new home", () => {
    const keptLater = {
      ...movedEntry("claude-code"),
      decision: "stayed",
      fromFolder: "/Users/me/Desktop/Code/vybekiit",
    };
    const stateFolder = createStateFolder([movedEntry("claude-code"), keptLater]);

    const execution = runHook({ stateFolder, agent: "claude-code", cwd: "/Users/me/Desktop/Code", source: "resume" });

    expect(JSON.parse(execution.stdout).systemMessage).toContain("(from ~/Desktop/Code)");
  });

  it("tells Codex about each move once", () => {
    const stateFolder = createStateFolder([movedEntry("codex")]);

    const first = runHook({ stateFolder, agent: "codex", cwd: "/Users/me/Desktop/Code/vybekiit", source: "resume" });
    const second = runHook({ stateFolder, agent: "codex", cwd: "/Users/me/Desktop/Code/vybekiit", source: "resume" });

    expect(JSON.parse(first.stdout).systemMessage).toContain("`codex resume` lists it there");
    expect(second.stdout).toBe("");
    expect(readFileSync(path.join(stateFolder, "ledger.jsonl"), "utf8")).toContain('"notifiedAt":"20');
  });

  it("fails open on malformed input", () => {
    const stateFolder = createStateFolder([]);

    const execution = spawnSync(process.execPath, ["--import", "tsx", hookPath], {
      cwd: packageRoot,
      input: "{",
      encoding: "utf8",
      env: { ...process.env, AGENT_SETUP_AGENT_ID: "codex", AGENT_SETUP_REHOME_STATE_DIR: stateFolder },
    });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });
});
