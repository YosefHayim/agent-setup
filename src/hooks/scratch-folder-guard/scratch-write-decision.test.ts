import { describe, expect, it } from "vitest";

import { decideScratchWrite } from "./scratch-write-decision.js";

const systemScratchFolder = "/var/folders/1b/0zhz4fn11w5gpjqczstysy5m0000gn/T";
const workingDirectory = "/Users/me/repo";

const readDecisionTag = (toolName: string, toolDetails: unknown) =>
  decideScratchWrite({ toolName, toolInput: toolDetails, workingDirectory, systemScratchFolder })._tag;

describe("decideScratchWrite", () => {
  it.each([
    ["Write", { file_path: "/private/tmp/x.log", content: "a" }],
    ["Write", { file_path: "/tmp/x.log", content: "a" }],
    ["Write", { file_path: `${systemScratchFolder}/a.txt`, content: "a" }],
    ["Edit", { file_path: "/tmp/a.ts", old_string: "a", new_string: "b" }],
    ["NotebookEdit", { notebook_path: "/var/tmp/a.ipynb", new_source: "x" }],
    ["Bash", { command: "pnpm e2e > /tmp/e2e.log 2>&1" }],
    ["Bash", { command: "F=$(mktemp); echo hi > $F" }],
    ["Bash", { command: "echo hi | tee $TMPDIR/a" }],
    ["Bash", { command: "mkdir -p /private/tmp/work" }],
    ["Bash", { command: "export TMPDIR=/tmp/build && pnpm build" }],
    ["exec_command", { cmd: "cp a.txt /private/tmp/a.txt" }],
    ["apply_patch", { input: "*** Begin Patch\n*** Add File: /tmp/a.txt\n+hi\n*** End Patch" }],
    ["mcp__fs__write_file", { path: "/tmp/notes.md", content: "a" }],
  ])("blocks %s writing into a system temporary folder (%j)", (toolName, toolDetails) => {
    expect(readDecisionTag(toolName, toolDetails)).toBe("block");
  });

  it.each([
    ["Write", { file_path: "/Users/me/repo/a.ts", content: "a" }],
    ["Write", { file_path: "/Users/me/.claude/tmp/claude-501/p/s/scratchpad/a.txt", content: "a" }],
    ["Write", { file_path: "tmp/a.txt", content: "a" }],
    ["Bash", { command: "ls -la /private/tmp" }],
    ["Bash", { command: "rm -f /private/tmp/x.log" }],
    ["Bash", { command: "pnpm test > artifacts/test.log 2>&1" }],
    ["Read", { file_path: "/tmp/x.log" }],
    ["Grep", { pattern: "x", path: "/tmp" }],
  ])("allows %s outside system temporary folders or without a write (%j)", (toolName, toolDetails) => {
    expect(readDecisionTag(toolName, toolDetails)).toBe("allow");
  });

  it.each([
    ["cat > notes/commit.txt <<'EOF'\nImpact: /tmp is the scratch root.\nA git clone or worktree is kept.\nEOF"],
    ["git commit -m \"$(cat <<'EOF'\nstop writing logs to /tmp\n\nmkdir the repo folder instead\nEOF\n)\""],
    ['git commit -m "stop writing logs to /tmp and mkdir the repo folder"'],
    ["git commit -am 'use mktemp no more'"],
    ["gh pr create --title \"guard\" --body 'the hook blocks touch /tmp/a'"],
    ["git commit -F - <<'EOF'\nstop writing logs to /tmp\n\nmkdir the repo folder instead\nEOF"],
    ["git commit --file=- <<'EOF'\nstop writing logs to /tmp and mkdir the repo folder\nEOF"],
    ["git -C repo -c user.name=me commit -F - <<'EOF'\nstop writing logs to /tmp and mkdir the repo folder\nEOF"],
    ["cd repo && gh pr create --title guard --body-file - <<'EOF'\nthe hook blocks touch /tmp/a\nEOF"],
    ["gh release create v1 --notes-file - <<'EOF'\nthe hook blocks touch /tmp/a\nEOF"],
    ['gh api repos/me/repo/issues/3/comments --input - <<\'EOF\'\n{"body":"touch /tmp/a is blocked"}\nEOF'],
  ])("allows a command whose message text only mentions a write (%j)", (command) => {
    expect(readDecisionTag("Bash", { command })).toBe("allow");
  });

  it.each([
    ["bash <<'EOF'\necho hi > /tmp/x.log\nEOF"],
    ["python3 - <<'EOF'\nopen('/tmp/x.log', 'w').write('a')\nEOF"],
    ["cat > notes/a.txt <<EOF\n$(touch /tmp/x.log)\nEOF"],
    ["cat <<'EOF' | sh\ntouch /tmp/x.log\nEOF"],
    ["cat <<'EOF' > >(sh)\ntouch /tmp/x.log\nEOF"],
    ["cat > >(sh) <<'EOF'\ntouch /tmp/x.log\nEOF"],
    ["bash -c \"$(cat <<'EOF'\ntouch /tmp/x.log\nEOF\n)\""],
    ["cat > /tmp/a.txt <<'EOF'\nhello\nEOF"],
    ["cat > notes/a.txt <<'EOF'\nhello\nEOF\ntouch /tmp/x.log"],
    ['git commit -m "$(touch /tmp/x.log)"'],
    ["git commit -m 'x' && touch /tmp/x.log"],
    ["touch -m '/tmp/x.log'"],
    ["git commit -F - <<EOF\n$(touch /tmp/x.log)\nEOF"],
    ["git commit -F - <<'EOF' | sh\ntouch /tmp/x.log\nEOF"],
    ["git run-script <<'EOF'\ntouch /tmp/x.log\nEOF"],
    ["git run-script -F - <<'EOF'\ntouch /tmp/x.log\nEOF"],
    ["git run-script commit -F - <<'EOF'\ntouch /tmp/x.log\nEOF"],
    ["git -C repo;sh commit -F - <<'EOF'\ntouch /tmp/x.log\nEOF"],
    ["gh run-script --input - <<'EOF'\ntouch /tmp/x.log\nEOF"],
    ["git commit -F - <<'EOF'\nhello\nEOF\ntouch /tmp/x.log"],
  ])("still blocks a write that sits beside or inside text the shell runs (%j)", (command) => {
    expect(readDecisionTag("Bash", { command })).toBe("block");
  });

  it("blocks any write command run from inside a system temporary folder", () => {
    const decision = decideScratchWrite({
      toolName: "Bash",
      toolInput: { command: "pnpm install" },
      workingDirectory: "/private/tmp/project",
      systemScratchFolder,
    });

    expect(decision).toMatchObject({ _tag: "block", reason: expect.stringContaining("gitignored folder") });
  });

  it("lets a shell inside a system temporary folder leave it with a leading cd", () => {
    const decision = decideScratchWrite({
      toolName: "Bash",
      toolInput: { command: "cd ~/repo && pnpm install" },
      workingDirectory: "/private/tmp/project",
      systemScratchFolder,
    });

    expect(decision).toEqual({ _tag: "allow" });
  });

  it("treats a copy command only as a whole word, not inside a longer name", () => {
    expect(readDecisionTag("Bash", { command: "./re-install /tmp/report.txt" })).toBe("allow");
    expect(readDecisionTag("Bash", { command: "pnpm build && install dist/cli /tmp/cli" })).toBe("block");
  });
});
