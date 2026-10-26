import { describe, expect, it } from "vitest";

import { commandFactsIn } from "./gitCommands.js";

describe("commandFactsIn", () => {
  it("reads the global options, subcommand and arguments of a git call", () => {
    const facts = commandFactsIn("git -C ../app -c Core.HooksPath=. --no-pager push origin --force", undefined);

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
    const facts = commandFactsIn("A=1 B=2 make; export C=3; env -i D=4 git status; echo E=5", undefined);

    expect(facts.assignments.map((assignment) => assignment.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("carries the last cd into later git calls", () => {
    const facts = commandFactsIn("cd one && cd two && git push", "/start");

    expect(facts.gitCalls.map((gitCall) => gitCall.changedFolder)).toEqual(["two"]);
    expect(facts.changedFolder).toBe("two");
  });
});
