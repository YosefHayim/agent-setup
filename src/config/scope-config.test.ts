import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";

import { managedConfigPath } from "./config-file.js";
import { defaultConfig } from "./config-schema.js";
import { readConfigAt } from "./scope-config.js";

const writeConfig = (request: { readonly root: string; readonly config: object }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configPath = path.join(request.root, managedConfigPath);
    yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
    yield* fileSystem.writeFileString(configPath, `${JSON.stringify(request.config)}\n`);
  });

const makeRoots = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const homeRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-config-settings-home-" });
  const projectRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-config-settings-project-" });
  return { homeRoot, projectRoot };
});

layer(NodeContext.layer)("readConfigAt", (it) => {
  it.scoped("reads the root's own config.json before the global one", () =>
    Effect.gen(function* () {
      const { homeRoot, projectRoot } = yield* makeRoots;
      yield* writeConfig({ root: homeRoot, config: { debugLogs: true } });
      yield* writeConfig({ root: projectRoot, config: { sessionRehomeRoots: ["vendor"] } });

      const config = yield* readConfigAt({ root: projectRoot, homeRoot });

      expect(config).toEqual({ ...defaultConfig, sessionRehomeRoots: ["vendor"] });
    }),
  );

  it.scoped("falls back to the global config.json, then to defaults", () =>
    Effect.gen(function* () {
      const { homeRoot, projectRoot } = yield* makeRoots;

      expect(yield* readConfigAt({ root: projectRoot, homeRoot })).toEqual(defaultConfig);

      yield* writeConfig({ root: homeRoot, config: { debugLogs: true } });
      expect((yield* readConfigAt({ root: projectRoot, homeRoot })).debugLogs).toBe(true);
    }),
  );
});
