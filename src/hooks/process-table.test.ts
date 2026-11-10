import { spawn } from "node:child_process";
import { once } from "node:events";

import { describe, expect, it } from "vitest";

import { elapsedSecondsOf, runningProcesses } from "./process-table.js";

describe("runningProcesses", () => {
  it("lists a running child with its parent, short name, and full command line", async () => {
    const child = spawn("sleep", ["61.5"]);
    await once(child, "spawn");

    const listedChild = runningProcesses().find((running) => running.processId === child.pid);
    child.kill();

    expect(listedChild).toMatchObject({ parentProcessId: process.pid, name: "sleep", commandLine: "sleep 61.5" });
    expect(listedChild?.elapsedSeconds).toBeLessThan(60);
  });
});

describe("elapsedSecondsOf", () => {
  it("reads minutes and seconds", () => {
    expect(elapsedSecondsOf("03:04")).toBe(184);
  });

  it("reads hours, minutes and seconds", () => {
    expect(elapsedSecondsOf("01:03:04")).toBe(3_784);
  });

  it("reads days, hours, minutes and seconds", () => {
    expect(elapsedSecondsOf("2-01:03:04")).toBe(176_584);
  });

  it("reads a text in another shape as zero", () => {
    expect(elapsedSecondsOf("soon")).toBe(0);
  });
});
