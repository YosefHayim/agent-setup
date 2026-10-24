import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { hasRunningSubagents } from "./claudeSubagents.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const workspaces: Array<string> = [];

const createHomeRoot = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-claude-subagents-"));
  workspaces.push(homeRoot);
  return homeRoot;
};

const subagentFolderOf = (configRoot: string) =>
  path.join(configRoot, "projects", "-Users-me-repo", sessionId, "subagents");

const writeSubagent = (request: {
  readonly configRoot: string;
  readonly agentName: string;
  readonly meta: Record<string, unknown>;
  readonly transcriptLines: ReadonlyArray<Record<string, unknown>>;
}) => {
  const subagentFolder = subagentFolderOf(request.configRoot);
  mkdirSync(subagentFolder, { recursive: true });
  writeFileSync(path.join(subagentFolder, `${request.agentName}.meta.json`), JSON.stringify(request.meta));
  const transcript = request.transcriptLines.map((line) => `${JSON.stringify(line)}\n`).join("");
  writeFileSync(path.join(subagentFolder, `${request.agentName}.jsonl`), transcript);
};

const assistantTurn = (stopReason: string | null) => ({
  type: "assistant",
  message: { role: "assistant", stop_reason: stopReason },
});

const toolAnswer = { type: "user", message: { role: "user", content: [{ type: "tool_result" }] } };

// A folder that links to itself cannot be listed even by root, which ignores file modes.
const linkToItself = (folder: string) => {
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(folder, folder);
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("hasRunningSubagents", () => {
  it("counts a subagent whose last turn still waits on a tool, even after the tool answered", () => {
    const homeRoot = createHomeRoot();
    writeSubagent({
      configRoot: path.join(homeRoot, ".claude"),
      agentName: "agent-a1",
      meta: { agentType: "general-purpose" },
      transcriptLines: [assistantTurn("tool_use"), toolAnswer],
    });

    expect(hasRunningSubagents({ homeRoot, sessionId })).toBe(true);
  });

  it("counts a subagent that never answered", () => {
    const homeRoot = createHomeRoot();
    writeSubagent({
      configRoot: path.join(homeRoot, ".claude"),
      agentName: "agent-a1",
      meta: { agentType: "general-purpose" },
      transcriptLines: [toolAnswer],
    });

    expect(hasRunningSubagents({ homeRoot, sessionId })).toBe(true);
  });

  it("counts a subagent whose last turn has no stop reason yet", () => {
    const homeRoot = createHomeRoot();
    writeSubagent({
      configRoot: path.join(homeRoot, ".claude"),
      agentName: "agent-a1",
      meta: { agentType: "general-purpose" },
      transcriptLines: [assistantTurn("tool_use"), toolAnswer, assistantTurn(null)],
    });

    expect(hasRunningSubagents({ homeRoot, sessionId })).toBe(true);
  });

  it("skips a subagent that ended its turn though its meta file never said finished", () => {
    const homeRoot = createHomeRoot();
    writeSubagent({
      configRoot: path.join(homeRoot, ".claude"),
      agentName: "agent-a1",
      meta: { agentType: "general-purpose" },
      transcriptLines: [assistantTurn("tool_use"), toolAnswer, assistantTurn("end_turn")],
    });

    expect(hasRunningSubagents({ homeRoot, sessionId })).toBe(false);
  });

  it("skips a subagent marked finished without reading its transcript", () => {
    const homeRoot = createHomeRoot();
    writeSubagent({
      configRoot: path.join(homeRoot, ".claude"),
      agentName: "agent-a1",
      meta: { agentType: "general-purpose", finished: true },
      transcriptLines: [assistantTurn("tool_use")],
    });

    expect(hasRunningSubagents({ homeRoot, sessionId })).toBe(false);
  });

  it("finds a running subagent under a second account's config root", () => {
    const homeRoot = createHomeRoot();
    mkdirSync(path.join(homeRoot, ".claude"));
    writeSubagent({
      configRoot: path.join(homeRoot, ".claude-account2"),
      agentName: "agent-a1",
      meta: { agentType: "general-purpose" },
      transcriptLines: [assistantTurn("tool_use")],
    });

    expect(hasRunningSubagents({ homeRoot, sessionId })).toBe(true);
  });

  it("reads a session that never started a subagent as having none", () => {
    const homeRoot = createHomeRoot();
    mkdirSync(path.join(homeRoot, ".claude", "projects", "-Users-me-repo"), { recursive: true });

    expect(hasRunningSubagents({ homeRoot, sessionId })).toBe(false);
  });

  it("throws when the projects folder cannot be listed", () => {
    const homeRoot = createHomeRoot();
    linkToItself(path.join(homeRoot, ".claude", "projects"));

    expect(() => hasRunningSubagents({ homeRoot, sessionId })).toThrow();
  });
});
