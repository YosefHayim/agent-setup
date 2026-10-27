import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve(import.meta.dirname, "../skills/updateAgentDocs/scripts/fetchOfficialAgentDocs.mjs");
const EXPECTED_USAGE = "Usage: node scripts/fetchOfficialAgentDocs.mjs --save-to <folder>";

describe("fetchOfficialAgentDocs script", () => {
  it("exits non-zero with a usage line when --save-to is missing", () => {
    const run = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: "utf8" });

    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe(EXPECTED_USAGE);
  });
});
