import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { managedSettingsPath } from "./config-file.js";
import { defaultSettings } from "./config-schema.js";
import { readSettingsAt } from "./scope-config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const directoriesToRemove = temporaryDirectories.splice(0);
  await Promise.all(directoriesToRemove.map((directory) => rm(directory, { recursive: true, force: true })));
});

const makeTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);

  return directory;
};

const makeRoots = async (): Promise<{ homeRoot: string; projectRoot: string }> => {
  const homeRoot = await makeTemporaryDirectory("agent-setup-config-settings-home-");
  const projectRoot = await makeTemporaryDirectory("agent-setup-config-settings-project-");

  return { homeRoot, projectRoot };
};

const writeSettings = async (request: { readonly root: string; readonly config: object }): Promise<void> => {
  const settingsPath = join(request.root, managedSettingsPath);
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(request.config)}\n`);
};

describe("readConfigAt", () => {
  it("reads the root's own config.json before the global one", async () => {
    const { homeRoot, projectRoot } = await makeRoots();
    await writeSettings({ root: homeRoot, config: { debugLogs: true } });
    await writeSettings({ root: projectRoot, config: { sessionRehomeRoots: ["vendor"] } });

    const settingsAtProjectRoot = await readSettingsAt({ root: projectRoot, homeRoot });

    expect(settingsAtProjectRoot).toEqual({ ...defaultSettings, sessionRehomeRoots: ["vendor"] });
  });

  it("falls back to the global config.json, then to defaults", async () => {
    const { homeRoot, projectRoot } = await makeRoots();

    expect(await readSettingsAt({ root: projectRoot, homeRoot })).toEqual(defaultSettings);

    await writeSettings({ root: homeRoot, config: { debugLogs: true } });
    expect((await readSettingsAt({ root: projectRoot, homeRoot })).debugLogs).toBe(true);
  });
});
