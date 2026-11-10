import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { managedSettingsPath } from "../config/config-file.js";
import { defaultSettings } from "../config/config-schema.js";
import { hooksPath } from "../install/install-paths.js";
import { decodeHookSettings } from "./hook-config.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settingsModuleOrigin = fileURLToPath(new URL("./hook-config.ts", import.meta.url));

describe("hook config resolution", () => {
  it("keeps the dependency-free hook defaults aligned with application defaults", () => {
    const hookDefaults = decodeHookSettings({});
    for (const [field, value] of Object.entries(hookDefaults)) {
      expect(value).toEqual(Object.getOwnPropertyDescriptor(defaultSettings, field)?.value);
    }
  });

  it("reads the install-root config.json from the installed hook layout", () => {
    // realpath: the module resolves its own real path, and macOS temp folders sit behind a /var symlink.
    const installRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "agent-setup-hook-config-")));
    try {
      // Install copies the shared files in src/hooks into each feature's lib/ under hooksPath.
      const installedModule = path.join(installRoot, hooksPath, "scratch-folder-guard", "lib", "hook-config.ts");
      const installedSettings = path.join(installRoot, managedSettingsPath);
      mkdirSync(path.dirname(installedModule), { recursive: true });
      copyFileSync(settingsModuleOrigin, installedModule);
      // Installed hooks are .js that Node detects as ES modules. On Node 22, tsx loads a .ts copy outside any
      // package as CommonJS and drops its named exports, so mark the temp tree as ESM.
      writeFileSync(path.join(installRoot, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
      writeFileSync(installedSettings, `${JSON.stringify({ debugLogs: true, sessionRehomeRoots: ["Work"] })}\n`);

      const printSettings = [
        `const { installRoot, readConfig } = await import(${JSON.stringify(pathToFileURL(installedModule).href)});`,
        "process.stdout.write(JSON.stringify({ installRoot, config: readConfig() }));",
      ].join("\n");
      const execution = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", printSettings],
        {
          cwd: packageRoot,
          encoding: "utf8",
        },
      );

      expect(execution.stderr).toBe("");
      expect(execution.status).toBe(0);
      const printed = JSON.parse(execution.stdout);
      expect(printed.installRoot).toBe(path.join(installRoot, ".claude", "agent-setup"));
      expect(printed.config.debugLogs).toBe(true);
      expect(printed.config.sessionRehomeRoots).toEqual(["Work"]);
      expect(printed.config.diskCleanupRoots).toEqual(defaultSettings.diskCleanupRoots);
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it("keeps the default for a field whose value has the wrong shape", () => {
    const settings = decodeHookSettings({ debugLogs: "yes" });
    expect(settings.debugLogs).toBe(defaultSettings.debugLogs);
  });

  it("trims root folders and drops blank ones, which would scan the whole home folder", () => {
    const hookSettings = decodeHookSettings({
      sessionRehomeRoots: ["", "  ", "Desktop/Code", 7],
      diskCleanupRoots: [" ", " Projects "],
    });
    expect(hookSettings.sessionRehomeRoots).toEqual(["Desktop/Code"]);
    expect(hookSettings.diskCleanupRoots).toEqual(["Projects"]);
  });
});
