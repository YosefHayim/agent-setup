import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { managedConfigPath } from "./config-file.js";
import { defaultConfig } from "./config-schema.js";
import { readConfigAt } from "./scope-config.js";

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

const writeConfig = async (request: { readonly root: string; readonly config: object }): Promise<void> => {
  const configPath = join(request.root, managedConfigPath);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(request.config)}\n`);
};

describe("readConfigAt", () => {
  it("reads the root's own config.json before the global one", async () => {
    const { homeRoot, projectRoot } = await makeRoots();
    await writeConfig({ root: homeRoot, config: { debugLogs: true } });
    await writeConfig({ root: projectRoot, config: { sessionRehomeRoots: ["vendor"] } });

    const configAtProjectRoot = await readConfigAt({ root: projectRoot, homeRoot });

    expect(configAtProjectRoot).toEqual({ ...defaultConfig, sessionRehomeRoots: ["vendor"] });
  });

  it("falls back to the global config.json, then to defaults", async () => {
    const { homeRoot, projectRoot } = await makeRoots();

    expect(await readConfigAt({ root: projectRoot, homeRoot })).toEqual(defaultConfig);

    await writeConfig({ root: homeRoot, config: { debugLogs: true } });
    expect((await readConfigAt({ root: projectRoot, homeRoot })).debugLogs).toBe(true);
  });
});
