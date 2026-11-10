import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./scratch-folder-guard.ts", import.meta.url));

const runHook = (hookDetails: string) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], { input: hookDetails, encoding: "utf8" });

describe("scratchFolderGuard process boundary", () => {
  it("fails open with clean stdout when hook input is malformed", () => {
    const execution = runHook("{");

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe("");
  });

  it("denies a write into /tmp through the Claude hook protocol", () => {
    const execution = runHook(
      JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/tmp/e2e.log", content: "a" }, cwd: "/repo" }),
    );

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    expect(JSON.parse(execution.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny", hookEventName: "PreToolUse" },
    });
  });

  it("denies a Codex shell call that copies into /private/tmp using its workdir", () => {
    const execution = runHook(
      JSON.stringify({
        tool_name: "exec_command",
        tool_input: { cmd: "cp a.txt /private/tmp/a.txt", workdir: "/repo" },
      }),
    );

    expect(JSON.parse(execution.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("stays silent for a commit whose message only mentions /tmp", () => {
    const command =
      "git commit -m \"$(cat <<'EOF'\nstop writing logs to /tmp and git clone into the scratchpad\nEOF\n)\"";
    const execution = runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: "/repo" }));

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("stays silent for a commit whose message comes on stdin and only mentions /tmp", () => {
    const command = "git commit -F - <<'EOF'\nstop writing logs to /tmp and git clone into the scratchpad\nEOF";
    const execution = runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: "/repo" }));

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });

  it("denies a shell script fed through a heredoc that writes into /tmp", () => {
    const command = "bash <<'EOF'\necho hi > /tmp/e2e.log\nEOF";
    const execution = runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: "/repo" }));

    expect(JSON.parse(execution.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("stays silent for a write inside the repository", () => {
    const execution = runHook(
      JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/repo/a.ts", content: "a" }, cwd: "/repo" }),
    );

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
  });
});
