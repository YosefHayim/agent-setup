import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createPathMatcher } from "./path-matcher.js";
import { readClaudeEvidence, readCodexEvidence } from "./session-evidence.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const homeRoot = "/Users/me";
const codeFolder = "/Users/me/Desktop/Code";
const matchers = {
  matchPaths: createPathMatcher([{ name: "vybekiit", root: `${codeFolder}/vybekiit` }]),
  matchKeywords: () => new Set<string>(),
};
const workspaces: Array<string> = [];

const writeTranscript = (lines: ReadonlyArray<object>): string => {
  const folder = mkdtempSync(path.join(packageRoot, "scratch-session-evidence-"));
  workspaces.push(folder);
  const transcriptFile = path.join(folder, "session.jsonl");
  writeFileSync(transcriptFile, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  return transcriptFile;
};

const claudeBash = (command: string) => ({
  type: "assistant",
  cwd: codeFolder,
  message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command } }] },
});

const codexCommand = (command: string) => ({
  type: "event_msg",
  payload: {
    type: "item_completed",
    item: { type: "CommandExecution", cwd: `file://${codeFolder}`, command: ["/bin/zsh", "-lc", command] },
  },
});

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("session evidence", () => {
  it("resolves relative and ~ paths in Claude Code commands against the folder they ran in", () => {
    const transcriptFile = writeTranscript([
      claudeBash("cat vybekiit/package.json"),
      claudeBash("sed -n '1,20p' ~/Desktop/Code/vybekiit/README.md"),
      claudeBash("cat > vybekiit/notes.md <<'EOF'\nhello\nEOF"),
      claudeBash("npm test"),
    ]);

    const evidence = readClaudeEvidence({ transcriptFile, matchers, homeRoot });

    expect(evidence.pathHits.get("vybekiit")).toBe(3);
  });

  it("resolves a Codex command's relative paths against its file:// working folder", () => {
    const transcriptFile = writeTranscript([
      codexCommand("cat vybekiit/package.json vybekiit/README.md"),
      codexCommand("ls -la"),
    ]);

    const evidence = readCodexEvidence({ transcriptFile, matchers, homeRoot });

    expect(evidence.pathHits.get("vybekiit")).toBe(1);
  });
});
