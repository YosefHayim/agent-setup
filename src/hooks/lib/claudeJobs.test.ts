import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { unfinishedClaudeJobStates } from "./claudeJobs.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workingSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const doneSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const workspaces: Array<string> = [];

const createHomeRoot = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-claude-jobs-"));
  workspaces.push(homeRoot);
  return homeRoot;
};

const writeJobState = (request: {
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
const linkToItself = (folder: string) => {
  mkdirSync(path.dirname(folder), { recursive: true });
  symlinkSync(folder, folder);
};

const hasJobFor = (request: { readonly homeRoot: string; readonly sessionId: string }): boolean =>
  unfinishedClaudeJobStates(request.homeRoot).some((jobState) => jobState.sessionId === request.sessionId);

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("unfinishedClaudeJobStates", () => {
  it("lists a job that is still working and skips one that is done", () => {
    const homeRoot = createHomeRoot();
    const configRoot = path.join(homeRoot, ".claude");
    writeJobState({ configRoot, jobName: "working-job", sessionId: workingSessionId, state: "working" });
    writeJobState({ configRoot, jobName: "done-job", sessionId: doneSessionId, state: "done" });

    expect(hasJobFor({ homeRoot, sessionId: workingSessionId })).toBe(true);
    expect(hasJobFor({ homeRoot, sessionId: doneSessionId })).toBe(false);
  });

  it("reads a config root that never ran a background job as holding none", () => {
    const homeRoot = createHomeRoot();
    mkdirSync(path.join(homeRoot, ".claude"));
    writeJobState({
      configRoot: path.join(homeRoot, ".claude-work"),
      jobName: "working-job",
      sessionId: workingSessionId,
      state: "working",
    });

    expect(hasJobFor({ homeRoot, sessionId: workingSessionId })).toBe(true);
  });

  it("fails while a jobs folder cannot be listed, since any job could be running", () => {
    const homeRoot = createHomeRoot();
    linkToItself(path.join(homeRoot, ".claude", "jobs"));

    expect(() => unfinishedClaudeJobStates(homeRoot)).toThrow();
  });
});
