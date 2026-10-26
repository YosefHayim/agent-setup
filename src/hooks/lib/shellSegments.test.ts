import { describe, expect, it } from "vitest";

import { SHELL_VALUE, shellSegments } from "./shellSegments.js";

const segmentWords = (command: string) => shellSegments(command).map((segment) => segment.words);

describe("shellSegments", () => {
  it("splits on command separators and substitutions and drops redirects", () => {
    expect(segmentWords("kill $(pgrep -f vite) 2>&1 && echo done > out.log")).toEqual([
      ["kill", "$"],
      ["pgrep", "-f", "vite"],
      ["echo", "done"],
    ]);
  });

  it("keeps quoted text as one word and unescapes it", () => {
    expect(segmentWords(`pkill -f 'node .*server' "say \\"hi\\"; ok" a\\;b`)).toEqual([
      ["pkill", "-f", "node .*server", 'say "hi"; ok', "a;b"],
    ]);
  });

  it("joins a line continuation and splits on a newline", () => {
    expect(segmentWords("pkill \\\n-f vite\nls")).toEqual([["pkill", "-f", "vite"], ["ls"]]);
  });

  it("joins a line continuation inside double quotes", () => {
    expect(segmentWords('pkill -f "ca\\\nt"')).toEqual([["pkill", "-f", "cat"]]);
  });

  it("records the breaks around each segment", () => {
    expect(shellSegments("kill $(pgrep -f vite) | cat")).toEqual([
      { words: ["kill", "$"], openedBy: "", closedBy: "(" },
      { words: ["pgrep", "-f", "vite"], openedBy: "(", closedBy: ")" },
      { words: ["cat"], openedBy: "|", closedBy: "" },
    ]);
  });

  it("drops comments but keeps # inside a word or quotes", () => {
    expect(segmentWords("# pkill -f cat\necho a#b '#c' \"x\"#y # trailing; note")).toEqual([
      ["echo", "a#b", "#c", "x#y"],
    ]);
  });

  it("marks shell expansions as unknown text, except inside single quotes", () => {
    expect(segmentWords(`pkill -f "$PATTERN" \${NAME}-x $1 'end$' \\$HOME`)).toEqual([
      ["pkill", "-f", SHELL_VALUE, `${SHELL_VALUE}-x`, SHELL_VALUE, "end$", "$HOME"],
    ]);
  });
});
