import { describe, expect, it } from "vitest";

import { shellSegments } from "./shellSegments.js";

describe("shellSegments", () => {
  it("splits on command separators and substitutions and drops redirects", () => {
    expect(shellSegments("kill $(pgrep -f vite) 2>&1 && echo done > out.log")).toEqual([
      ["kill", "$"],
      ["pgrep", "-f", "vite"],
      ["echo", "done"],
    ]);
  });

  it("keeps quoted text as one word and unescapes it", () => {
    expect(shellSegments(`pkill -f 'node .*server' "say \\"hi\\"; ok" a\\;b`)).toEqual([
      ["pkill", "-f", "node .*server", 'say "hi"; ok', "a;b"],
    ]);
  });

  it("joins a line continuation and splits on a newline", () => {
    expect(shellSegments("pkill \\\n-f vite\nls")).toEqual([["pkill", "-f", "vite"], ["ls"]]);
  });
});
