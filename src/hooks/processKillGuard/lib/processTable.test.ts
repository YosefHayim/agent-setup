import { spawn } from "node:child_process";
import { once } from "node:events";

import { describe, expect, it } from "vitest";

import { runningProcesses } from "./processTable.js";

describe("runningProcesses", () => {
  it("lists a running child with its parent, short name, and full command line", async () => {
    const child = spawn("sleep", ["61.5"]);
    await once(child, "spawn");

    const listedChild = runningProcesses().find((running) => running.processId === child.pid);
    child.kill();

    expect(listedChild).toMatchObject({ parentProcessId: process.pid, name: "sleep", commandLine: "sleep 61.5" });
  });
});
