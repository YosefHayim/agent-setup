import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { defaultConfig } from "#src/config/config-schema.js";
import { installRequestSchema } from "#src/install/install-request.js";
import { isBareArgv } from "./main.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageVersion = String(JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version);
const CLI_LINE = path.join(REPO_ROOT, "src/cli/main.ts");
const CLI_TEST_TIMEOUT = 75_000;

// Async on purpose: a synchronous spawn blocks the vitest worker long enough for its RPC calls to time out.
const runCli = (argumentList: ReadonlyArray<string>, environment: NodeJS.ProcessEnv = {}) =>
  new Promise<{ readonly stdout: string; readonly exitCode: number }>((fulfill) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI_LINE, ...argumentList], {
      cwd: REPO_ROOT,
      timeout: 60_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, FORCE_COLOR: "0", ...environment },
    });
    const chunks: Array<string> = [];
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => chunks.push(chunk));
    child.on("close", (code) => {
      const isExitedBySignal = code === null;
      fulfill({ stdout: chunks.join(""), exitCode: isExitedBySignal ? 1 : code });
    });
  });

// A throwaway directory, used as HOME so the global scope never touches the machine's real install.
const createFreshDirectory = async (run: (directory: string) => Promise<void>) => {
  const directory = mkdtempSync(path.join(tmpdir(), "agent-setup-cli-"));
  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("isBareArgv", () => {
  it("detects bare invocations that should route to the menu or help", () => {
    expect(isBareArgv(["node", "agent-setup"])).toBe(true);
    expect(isBareArgv(["node", "agent-setup", "install"])).toBe(false);
    expect(isBareArgv(["node", "agent-setup", "--help"])).toBe(false);
  });
});

describe("CLI help", () => {
  it.each([
    {
      args: ["--help"],
      shows: ["agent-setup", "install", "catalog", "workflow"],
      hides: ["voice", "openrouter", "--wizard", "--log-level", "--completions"],
    },
    { args: ["config", "--help"], shows: ["Set one managed setting"], hides: ["pick-refine"] },
    {
      args: ["install", "--help"],
      shows: ["[feature-id...]", "--scope <scope>", "global home installation root (default)"],
      hides: ["--features", "--global", "--project"],
    },
  ])(
    "documents `$args`",
    async ({ args: argumentList, shows, hides }) => {
      const execution = await runCli(argumentList);

      expect(execution.exitCode).toBe(0);
      for (const shownPhrase of shows) expect(execution.stdout).toContain(shownPhrase);
      for (const hiddenPhrase of hides) expect(execution.stdout).not.toContain(hiddenPhrase);
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "prints help, not a prompt, for a bare non-TTY invocation",
    async () => {
      const execution = await runCli([]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain("agent-setup");
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "prints version",
    async () => {
      const execution = await runCli(["-V"]);

      expect(execution.exitCode).toBe(0);
      expect(execution.stdout).toContain(packageVersion);
    },
    CLI_TEST_TIMEOUT,
  );
});

describe("CLI exit codes", () => {
  it(
    "uses exit 2 when a non-interactive destructive command lacks --yes",
    async () => {
      const execution = await runCli(["uninstall"]);

      expect(execution.exitCode).toBe(2);
      expect(execution.stdout).toContain("Non-interactive uninstall requires --yes.");
    },
    CLI_TEST_TIMEOUT,
  );

  it(
    "uses exit 2 for an invalid managed setting value",
    () =>
      createFreshDirectory(async (homeRoot) => {
        expect((await runCli(["config", "set", "debug-logs", "sometimes"], { HOME: homeRoot })).exitCode).toBe(2);
      }),
    CLI_TEST_TIMEOUT,
  );
});

describe("config reset", () => {
  it(
    "replaces a config.json that no longer decodes without reading it first",
    () =>
      createFreshDirectory(async (homeRoot) => {
        const settingsPath = path.join(homeRoot, ".claude/agent-setup/config.json");
        mkdirSync(path.dirname(settingsPath), { recursive: true });
        writeFileSync(settingsPath, '{ "unknownSetting": true,\n');
        const refusedSet = await runCli(["config", "set", "debug-logs", "true"], { HOME: homeRoot });
        const execution = await runCli(["config", "reset", "--yes", "--format", "json"], { HOME: homeRoot });

        expect(refusedSet.exitCode).not.toBe(0);
        expect(execution.exitCode).toBe(0);
        expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual(defaultConfig);
      }),
    CLI_TEST_TIMEOUT,
  );
});

describe("install request schema decoding smoke", () => {
  it("decodes a complete scripted install request", () => {
    const request = {
      destination: { _tag: "project", root: REPO_ROOT },
      host: { homeRoot: REPO_ROOT },
      preparedPackage: { root: path.join(REPO_ROOT, "dist", "prepared"), version: "0.11.0" },
      features: { _tag: "defaults" },
      agents: { _tag: "selected", ids: ["claude-code"] },
      interaction: { _tag: "scripted" },
      configuration: { _tag: "selected", config: defaultConfig },
    };

    const decodedRequest = installRequestSchema.parse(request);

    expect(decodedRequest.destination._tag).toBe("project");
    expect(decodedRequest.features._tag).toBe("defaults");
  });
});
