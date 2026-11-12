import { describe, expect, it } from "vitest";

import type { RunningProcess } from "../process-table.js";
import {
  decideLeftoverProcesses,
  isNeverStopped,
  type LeftoverProcessCheck,
  readAncestorProcessIds,
} from "./leftover-process-decision.js";

const CODE_ROOT = "/Users/me/Code";
const GONE_FOLDER = `${CODE_ROOT}/repo/.worktrees/lane`;
const TEST_PROFILE = "/var/folders/ab/cd/T/lighthouse.Xy12Zk";
const ONE_HOUR_SECONDS = 3_600;

const createProcess = (overrides: Partial<RunningProcess>): RunningProcess => ({
  processId: 100,
  parentProcessId: 50,
  name: "node",
  commandLine: "node vite preview",
  elapsedSeconds: 10,
  ...overrides,
});

const createCheck = (overrides: Partial<LeftoverProcessCheck>): LeftoverProcessCheck => ({
  processes: [],
  protectedProcessIds: new Set(),
  workingFolders: new Map(),
  missingFolders: new Set(),
  codeRoots: [CODE_ROOT],
  finishedFolders: [],
  testBrowserMinimumAgeSeconds: ONE_HOUR_SECONDS,
  ...overrides,
});

const createBrowser = (overrides: Partial<RunningProcess>): RunningProcess =>
  createProcess({
    name: "Google Chrome",
    parentProcessId: 1,
    elapsedSeconds: ONE_HOUR_SECONDS + 1,
    commandLine: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${TEST_PROFILE} --remote-debugging-port=0`,
    ...overrides,
  });

describe("decideLeftoverProcesses", () => {
  it("stops a process whose working folder is gone under a code root", () => {
    const check = createCheck({
      processes: [createProcess({})],
      workingFolders: new Map([[100, GONE_FOLDER]]),
      missingFolders: new Set([GONE_FOLDER]),
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([
      { processId: 100, name: "node", reason: `working folder no longer exists: ${GONE_FOLDER}` },
    ]);
  });

  it("stops a process whose working folder is the code root itself and gone", () => {
    const check = createCheck({
      processes: [createProcess({})],
      workingFolders: new Map([[100, CODE_ROOT]]),
      missingFolders: new Set([CODE_ROOT]),
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toHaveLength(1);
  });

  it("keeps a process whose working folder still exists", () => {
    const check = createCheck({
      processes: [createProcess({})],
      workingFolders: new Map([[100, GONE_FOLDER]]),
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });

  it("keeps a process whose gone working folder is outside every code root", () => {
    const check = createCheck({
      processes: [createProcess({})],
      workingFolders: new Map([[100, "/Users/me/Code-other/lane"]]),
      missingFolders: new Set(["/Users/me/Code-other/lane"]),
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });

  it("accepts a code root written with a trailing slash", () => {
    const check = createCheck({
      processes: [createProcess({})],
      codeRoots: [`${CODE_ROOT}/`],
      workingFolders: new Map([[100, GONE_FOLDER]]),
      missingFolders: new Set([GONE_FOLDER]),
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toHaveLength(1);
  });

  it("keeps a process with no known working folder", () => {
    const check = createCheck({ processes: [createProcess({})] });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });

  it("keeps a protected process even when its working folder is gone", () => {
    const check = createCheck({
      processes: [createProcess({})],
      protectedProcessIds: new Set([100]),
      workingFolders: new Map([[100, GONE_FOLDER]]),
      missingFolders: new Set([GONE_FOLDER]),
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });

  it("stops an orphaned test browser over the age limit together with its helper processes", () => {
    const helper = createProcess({
      processId: 101,
      parentProcessId: 100,
      name: "Google Chrome Helper",
      commandLine: `Google Chrome Helper --type=renderer --user-data-dir=${TEST_PROFILE}`,
      elapsedSeconds: 5,
    });
    const check = createCheck({ processes: [createBrowser({}), helper] });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers.map((leftover) => leftover.processId)).toEqual([100, 101]);
    expect(leftovers[0]?.reason).toBe(`orphaned test browser with temporary profile: ${TEST_PROFILE}`);
  });

  it("stops playwright and puppeteer temporary profiles", () => {
    const playwright = createBrowser({
      processId: 201,
      commandLine: "chrome --user-data-dir=/private/var/folders/ab/T/playwright_chromiumdev_profile-AbC123",
    });
    const puppeteer = createBrowser({
      processId: 202,
      commandLine: "chrome --user-data-dir=/tmp/puppeteer_dev_chrome_profile-ZzZ",
    });
    const check = createCheck({ processes: [playwright, puppeteer] });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers.map((leftover) => leftover.processId)).toEqual([201, 202]);
  });

  it("keeps a test browser younger than the age limit", () => {
    const check = createCheck({ processes: [createBrowser({ elapsedSeconds: ONE_HOUR_SECONDS })] });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });

  it("keeps a test browser that still has a parent", () => {
    const check = createCheck({ processes: [createBrowser({ parentProcessId: 77 })] });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });

  it("keeps the owner's Chrome with a normal profile and a debug port", () => {
    const ownerChrome = createBrowser({
      commandLine:
        "Google Chrome --user-data-dir=/Users/me/Library/Application Support/Google/Chrome --remote-debugging-port=9223",
    });
    const check = createCheck({ processes: [ownerChrome] });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });

  it("keeps a temporary profile folder with a name that is not a test browser's", () => {
    const check = createCheck({
      processes: [createBrowser({ commandLine: "Google Chrome --user-data-dir=/var/folders/ab/T/my-own-profile" })],
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });

  it("keeps a test browser on a debug port the owner uses", () => {
    const check = createCheck({
      processes: [
        createBrowser({ commandLine: `Chrome --user-data-dir=${TEST_PROFILE} --remote-debugging-port=9222` }),
      ],
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers).toEqual([]);
  });
});

describe("decideLeftoverProcesses with finished Claude folders", () => {
  const finishedFolder = "/Users/me/.claude-account3/jobs/9b81403e/tmp";
  const testApp = createProcess({
    name: "Business OS",
    commandLine: `${finishedFolder}/run3/Trivial OS.app/Contents/MacOS/Business OS`,
  });

  it("stops a protected-looking app that runs from a finished job folder", () => {
    const check = createCheck({ processes: [testApp], finishedFolders: [finishedFolder] });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers.map((leftover) => leftover.processId)).toEqual([100]);
    expect(leftovers[0]?.reason).toContain(finishedFolder);
  });

  it("stops a process whose working folder is inside a finished folder", () => {
    const check = createCheck({
      processes: [createProcess({})],
      workingFolders: new Map([[100, `${finishedFolder}/run3`]]),
      finishedFolders: [finishedFolder],
    });

    const leftovers = decideLeftoverProcesses(check);

    expect(leftovers.map((leftover) => leftover.processId)).toEqual([100]);
  });

  it("keeps the owner's Business OS that runs from elsewhere", () => {
    const ownersApp = createProcess({
      name: "Business OS",
      commandLine: "/Applications/Business OS.app/Contents/MacOS/Business OS",
    });
    const check = createCheck({ processes: [ownersApp], finishedFolders: [finishedFolder] });

    expect(decideLeftoverProcesses(check)).toEqual([]);
  });

  it("keeps a live session process and a shell even inside a finished folder", () => {
    const liveSession = createProcess({ processId: 200, commandLine: `${finishedFolder}/x/run` });
    const shell = createProcess({ processId: 201, name: "zsh", commandLine: `${finishedFolder}/x/zsh` });
    const check = createCheck({
      processes: [liveSession, shell],
      protectedProcessIds: new Set([200]),
      finishedFolders: [finishedFolder],
    });

    expect(decideLeftoverProcesses(check)).toEqual([]);
  });

  it("keeps a process outside every finished folder, even one with a similar name", () => {
    const sibling = createProcess({ commandLine: `${finishedFolder}-other/run` });
    const check = createCheck({
      processes: [sibling],
      workingFolders: new Map([[100, `${finishedFolder}-other`]]),
      finishedFolders: [finishedFolder],
    });

    expect(decideLeftoverProcesses(check)).toEqual([]);
  });
});

describe("isNeverStopped", () => {
  const isStopProtected = (overrides: Partial<RunningProcess>): boolean =>
    isNeverStopped({ runningProcess: createProcess(overrides), protectedProcessIds: new Set([7]) });

  it("protects a process id in the protected set", () => {
    expect(isStopProtected({ processId: 7 })).toBe(true);
  });

  it("protects shells, terminals and agents by name", () => {
    expect(isStopProtected({ name: "zsh" })).toBe(true);
    expect(isStopProtected({ name: "claude" })).toBe(true);
  });

  it("protects Business OS, port 4823, Docker, VS Code and agent-voice by command line", () => {
    const protectedCommandLines = [
      "/Applications/Business OS.app/Contents/MacOS/Business OS",
      "node server.js --port 4823",
      "com.docker.backend",
      "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      "Code Helper (Renderer)",
      "node /Users/me/agent-voice/server.js",
    ];

    const reports = protectedCommandLines.map((commandLine) => isStopProtected({ commandLine }));

    expect(reports.every(Boolean)).toBe(true);
  });

  it("leaves an ordinary dev server open to the rules", () => {
    expect(isStopProtected({})).toBe(false);
  });
});

describe("ancestorProcessIds", () => {
  const chain = [
    createProcess({ processId: 300, parentProcessId: 200 }),
    createProcess({ processId: 200, parentProcessId: 100 }),
    createProcess({ processId: 100, parentProcessId: 1 }),
  ];

  it("lists the process and every parent up to launchd", () => {
    expect([...readAncestorProcessIds({ processes: chain, startProcessId: 300 })]).toEqual([300, 200, 100]);
  });

  it("stops at a parent missing from the table", () => {
    expect([...readAncestorProcessIds({ processes: chain, startProcessId: 999 })]).toEqual([999]);
  });

  it("stops when the parents loop", () => {
    const loop = [
      createProcess({ processId: 5, parentProcessId: 6 }),
      createProcess({ processId: 6, parentProcessId: 5 }),
    ];

    expect([...readAncestorProcessIds({ processes: loop, startProcessId: 5 })]).toEqual([5, 6]);
  });
});
