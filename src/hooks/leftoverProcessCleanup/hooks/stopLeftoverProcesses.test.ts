import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isProcessAlive } from "../../lib/processAlive.js";

const hookPath = fileURLToPath(new URL("./stopLeftoverProcesses.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const STAND_IN_SCRIPT = "console.log(process.pid); setInterval(() => {}, 1000)";
const homeRoots: Array<string> = [];
const standInProcessIds: Array<number> = [];

const createHome = (): string => {
  const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-leftover-process-cleanup-"));
  homeRoots.push(homeRoot);
  mkdirSync(path.join(homeRoot, "Desktop", "Code"), { recursive: true });
  return homeRoot;
};

// The shell starts the stand-in in the background and exits, so the stand-in is left with parent process 1.
const startStandIn = async (request: { readonly workingFolder: string; readonly extraArgument: string }) => {
  const starter = spawn(
    "sh",
    ["-c", `"$0" -e "$1" -- "$2" &`, process.execPath, STAND_IN_SCRIPT, request.extraArgument],
    {
      cwd: request.workingFolder,
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    },
  );
  const [printedProcessId] = await new Promise<Array<string>>((done) => {
    starter.stdout.once("data", (chunk: Buffer) => done(chunk.toString().trim().split("\n")));
  });
  const processId = Number(printedProcessId);
  standInProcessIds.push(processId);
  return processId;
};

const runHook = (homeRoot: string) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    input: "{}",
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeRoot,
      CLAUDE_CONFIG_DIR: path.join(homeRoot, ".claude"),
      AGENT_SETUP_LEFTOVER_PROCESS_CLEANUP_BROWSER_MINIMUM_AGE_SECONDS: "0",
    },
  });

// The short name differs by OS: macOS reports "node", Linux reports Node's main thread name.
const readProcessName = (processId: number): string =>
  spawnSync("ps", ["-o", "ucomm=", "-p", String(processId)], { encoding: "utf8" }).stdout.trim();

const readLog = (homeRoot: string): string =>
  readFileSync(path.join(homeRoot, ".local", "state", "agent-setup", "leftover-process-cleanup.log"), "utf8");

afterEach(() => {
  for (const processId of standInProcessIds.splice(0)) {
    if (isProcessAlive(processId)) {
      process.kill(processId, "SIGKILL");
    }
  }
  for (const homeRoot of homeRoots.splice(0)) {
    rmSync(homeRoot, { recursive: true, force: true });
  }
});

describe("stopLeftoverProcesses hook", () => {
  it("stops a server whose working folder was deleted, logs it, and prints nothing", async () => {
    const homeRoot = createHome();
    const laneFolder = path.join(homeRoot, "Desktop", "Code", "lane");
    mkdirSync(laneFolder);
    const processId = await startStandIn({ workingFolder: laneFolder, extraArgument: "server-in-deleted-folder" });
    const processName = readProcessName(processId);
    rmSync(laneFolder, { recursive: true });

    const hookRun = runHook(homeRoot);

    expect(hookRun.status).toBe(0);
    expect(hookRun.stdout).toBe("");
    expect(isProcessAlive(processId)).toBe(false);
    expect(readLog(homeRoot)).toContain(
      `pid=${processId} name="${processName}" reason=working folder no longer exists: ${laneFolder}\n`,
    );
  });

  it("keeps a server whose working folder still exists", async () => {
    const homeRoot = createHome();
    const laneFolder = path.join(homeRoot, "Desktop", "Code", "lane");
    mkdirSync(laneFolder);
    const processId = await startStandIn({ workingFolder: laneFolder, extraArgument: "server-in-live-folder" });

    const hookRun = runHook(homeRoot);

    expect(hookRun.status).toBe(0);
    expect(isProcessAlive(processId)).toBe(true);
    expect(existsSync(path.join(homeRoot, ".local", "state", "agent-setup", "leftover-process-cleanup.log"))).toBe(
      false,
    );
  });

  it("stops an orphaned test browser with a temporary profile and keeps one with the owner's profile", async () => {
    const homeRoot = createHome();
    const testBrowserId = await startStandIn({
      workingFolder: homeRoot,
      extraArgument: "--user-data-dir=/tmp/lighthouse.leftovertest",
    });
    const ownerBrowserId = await startStandIn({
      workingFolder: homeRoot,
      extraArgument: "--user-data-dir=/Users/owner/chrome-profile",
    });
    const testBrowserName = readProcessName(testBrowserId);
    await sleep(1_200);

    const hookRun = runHook(homeRoot);

    expect(hookRun.status).toBe(0);
    expect(isProcessAlive(testBrowserId)).toBe(false);
    expect(isProcessAlive(ownerBrowserId)).toBe(true);
    expect(readLog(homeRoot)).toContain(`pid=${testBrowserId} name="${testBrowserName}" reason=orphaned test browser`);
  });

  it("looks only once in a short time", async () => {
    const homeRoot = createHome();
    runHook(homeRoot);
    const laneFolder = path.join(homeRoot, "Desktop", "Code", "lane");
    mkdirSync(laneFolder);
    const processId = await startStandIn({ workingFolder: laneFolder, extraArgument: "server-after-a-look" });
    rmSync(laneFolder, { recursive: true });

    runHook(homeRoot);

    expect(isProcessAlive(processId)).toBe(true);
  });
});
