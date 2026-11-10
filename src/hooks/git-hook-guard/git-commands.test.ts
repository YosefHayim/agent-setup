import { describe, expect, it } from "vitest";

import { readCommandFactsIn } from "./git-commands.js";

describe("commandFactsIn", () => {
  it("reads the global options, subcommand and arguments of a git call", () => {
    const facts = readCommandFactsIn("git -C ../app -c Core.HooksPath=. --no-pager push origin --force", null);

    expect(facts.gitCalls).toEqual([
      {
        configKeys: ["core.hookspath"],
        repoFolders: ["../app"],
        changedFolder: undefined,
        subcommand: "push",
        args: ["origin", "--force"],
      },
    ]);
  });

  it("reads assignments before a program and after export or env", () => {
    const facts = readCommandFactsIn("A=1 B=2 make; export C=3; env -i D=4 git status; echo E=5", null);

    expect(facts.assignments.map((assignment) => assignment.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("carries the last cd into later git calls", () => {
    const facts = readCommandFactsIn("cd one && cd two && git push", "/start");

    expect(facts.gitCalls.map((gitCall) => gitCall.changedFolder)).toEqual(["two"]);
    expect(facts.changedFolder).toBe("two");
  });
});
