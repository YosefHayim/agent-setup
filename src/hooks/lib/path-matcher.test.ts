import { describe, expect, it } from "vitest";

import { createPathMatcher } from "./path-matcher.js";

describe("path matcher", () => {
  it("matches a root only at a path boundary and prefers the longest root", () => {
    const matchPaths = createPathMatcher([
      { name: "agent-runner", root: "/code/agent-runner" },
      { name: "agent-runner-e2e", root: "/code/agent-runner-e2e" },
    ]);

    expect([...matchPaths('{"file_path":"/code/agent-runner-e2e/src/cart.js"}')]).toEqual(["agent-runner-e2e"]);
    expect([...matchPaths("cd /code/agent-runner && pnpm test")]).toEqual(["agent-runner"]);
    expect([...matchPaths("/code/agent-runnerx")]).toEqual([]);
  });
});
