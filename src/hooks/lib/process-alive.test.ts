import { describe, expect, it } from "vitest";

import { isProcessAlive } from "./process-alive.js";

describe("isProcessAlive", () => {
  it("sees the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("sees a process that another user owns", () => {
    expect(isProcessAlive(1)).toBe(true);
  });

  it("never treats a missing or group pid as alive", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(Number.NaN)).toBe(false);
    expect(isProcessAlive(2_147_483_646)).toBe(false);
  });
});
