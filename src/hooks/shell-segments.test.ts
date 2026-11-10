import { describe, expect, it } from "vitest";

import { listShellSegments, SHELL_FIELD } from "./shell-segments.js";

const listSegmentWords = (command: string) => listShellSegments(command).map((segment) => segment.words);

describe("shellSegments", () => {
  it("splits on command separators and substitutions and drops redirects", () => {
    expect(listSegmentWords("kill $(pgrep -f vite) 2>&1 && echo done > out.log")).toEqual([
      ["kill", "$"],
      ["pgrep", "-f", "vite"],
      ["echo", "done"],
    ]);
  });

  it("keeps quoted text as one word and unescapes it", () => {
    expect(listSegmentWords(`pkill -f 'node .*server' "say \\"hi\\"; ok" a\\;b`)).toEqual([
      ["pkill", "-f", "node .*server", 'say "hi"; ok', "a;b"],
    ]);
  });

  it("keeps an empty quoted word", () => {
    expect(listSegmentWords(`git config core.hooksPath '' && pkill -f "" a''b`)).toEqual([
      ["git", "config", "core.hooksPath", ""],
      ["pkill", "-f", "", "ab"],
    ]);
  });

  it("joins a line continuation and splits on a newline", () => {
    expect(listSegmentWords("pkill \\\n-f vite\nls")).toEqual([["pkill", "-f", "vite"], ["ls"]]);
  });

  it("joins a line continuation inside double quotes", () => {
    expect(listSegmentWords('pkill -f "ca\\\nt"')).toEqual([["pkill", "-f", "cat"]]);
  });

  it("records the breaks around each segment", () => {
    expect(listShellSegments("kill $(pgrep -f vite) | cat")).toEqual([
      { words: ["kill", "$"], openedBy: "", closedBy: "(" },
      { words: ["pgrep", "-f", "vite"], openedBy: "(", closedBy: ")" },
      { words: ["cat"], openedBy: "|", closedBy: "" },
    ]);
  });

  it("drops comments but keeps # inside a word or quotes", () => {
    expect(listSegmentWords("# pkill -f cat\necho a#b '#c' \"x\"#y # trailing; note")).toEqual([
      ["echo", "a#b", "#c", "x#y"],
    ]);
  });

  it("marks shell expansions as unknown text, except inside single quotes", () => {
    expect(listSegmentWords(`pkill -f "$PATTERN" \${NAME}-x $1 'end$' \\$HOME`)).toEqual([
      ["pkill", "-f", SHELL_FIELD, `${SHELL_FIELD}-x`, SHELL_FIELD, "end$", "$HOME"],
    ]);
  });
});
