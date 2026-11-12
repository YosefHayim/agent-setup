import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { listFinishedClaudeJobTmpFolders, listUnfinishedClaudeJobStatuses } from "./claude-jobs.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workingSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const doneSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const workspaces: Array<string> = [];

const createHomeRoot = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-claude-jobs-"));
  workspaces.push(homeRoot);
  // The session running the tests sets CLAUDE_CONFIG_DIR to a real account folder, which would be read too.
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(homeRoot, ".claude"));
  return homeRoot;
};

const writeJobStatus = (request: {
  readonly configRoot: string;
  readonly jobName: string;
  readonly sessionId: string;
  readonly state: string;
}) => {
  const jobFolder = path.join(request.configRoot, "jobs", request.jobName);
  mkdirSync(jobFolder, { recursive: true });
  writeFileSync(
    path.join(jobFolder, "state.json"),
    JSON.stringify({ sessionId: request.sessionId, state: request.state }),
  );
};

// A folder that links to itself cannot be listed even by root, which ignores file modes.
const runLinkToItself = (folder: string) => {
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(folder, folder);
};

const hasJobFor = (request: { readonly homeRoot: string; readonly sessionId: string }): boolean =>
  listUnfinishedClaudeJobStatuses(request.homeRoot).some((jobStatus) => jobStatus.sessionId === request.sessionId);

afterEach(() => {
  vi.unstubAllEnvs();
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("unfinishedClaudeJobStates", () => {
  it("lists a job that is still working and skips one that is done", () => {
    const homeRoot = createHomeRoot();
    const settingsRoot = path.join(homeRoot, ".claude");
    writeJobStatus({ configRoot: settingsRoot, jobName: "working-job", sessionId: workingSessionId, state: "working" });
    writeJobStatus({ configRoot: settingsRoot, jobName: "done-job", sessionId: doneSessionId, state: "done" });

    expect(hasJobFor({ homeRoot, sessionId: workingSessionId })).toBe(true);
    expect(hasJobFor({ homeRoot, sessionId: doneSessionId })).toBe(false);
  });

  it("reads a config root that never ran a background job as holding none", () => {
    const homeRoot = createHomeRoot();
    mkdirSync(path.join(homeRoot, ".claude"));
    writeJobStatus({
      configRoot: path.join(homeRoot, ".claude-work"),
      jobName: "working-job",
      sessionId: workingSessionId,
      state: "working",
    });

    expect(hasJobFor({ homeRoot, sessionId: workingSessionId })).toBe(true);
  });

  it("fails while a jobs folder cannot be listed, since any job could be running", () => {
    const homeRoot = createHomeRoot();
    runLinkToItself(path.join(homeRoot, ".claude", "jobs"));

    expect(() => listUnfinishedClaudeJobStatuses(homeRoot)).toThrow();
  });
});

describe("listFinishedClaudeJobTmpFolders", () => {
  it("lists the tmp folder of done jobs in every account folder and leaves unfinished jobs out", () => {
    const homeRoot = createHomeRoot();
    const firstRoot = path.join(homeRoot, ".claude");
    const thirdRoot = path.join(homeRoot, ".claude-account3");
    writeJobStatus({ configRoot: firstRoot, jobName: "working-job", sessionId: workingSessionId, state: "working" });
    writeJobStatus({ configRoot: firstRoot, jobName: "done-job", sessionId: doneSessionId, state: "done" });
    writeJobStatus({ configRoot: thirdRoot, jobName: "other-done-job", sessionId: doneSessionId, state: "done" });

    const finishedFolders = listFinishedClaudeJobTmpFolders(homeRoot);

    expect(finishedFolders).toHaveLength(2);
    expect(finishedFolders).toContain(path.join(firstRoot, "jobs", "done-job", "tmp"));
    expect(finishedFolders).toContain(path.join(thirdRoot, "jobs", "other-done-job", "tmp"));
  });
});
