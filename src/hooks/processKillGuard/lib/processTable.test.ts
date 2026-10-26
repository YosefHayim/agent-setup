import { spawn } from "node:child_process";
import { once } from "node:events";

import { describe, expect, it } from "vitest";

import { runningProcesses } from "./processTable.js";

describe("runningProcesses", () => {
  it("lists a running child with its parent and full command line", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "console.log('ready'); setTimeout(() => {}, 60000)",
      "process-table-marker",
    ]);
    await once(child.stdout, "data");

    const listedChild = runningProcesses().find((running) => running.processId === child.pid);
    child.kill();

    expect(listedChild).toMatchObject({ parentProcessId: process.pid, name: "node" });
    expect(listedChild?.commandLine).toContain("process-table-marker");
  });
});
