import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeContext } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";

import { scanHost } from "./host-scan.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const createExecutable = (file: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
};

layer(NodeContext.layer)("scanHost", (it) => {
  it.effect("ignores the agent wrappers cmux puts on PATH but counts a real agent command", () =>
    Effect.gen(function* () {
      const homeRoot = mkdtempSync(path.join(packageRoot, "scratch-host-scan-"));
      const wrapperFolder = path.join(homeRoot, "cmux.app", "Contents", "Resources", "bin");
      const realFolder = path.join(homeRoot, "bin");
      createExecutable(path.join(wrapperFolder, "grok"));
      createExecutable(path.join(realFolder, "kimi"));
      const environmentBefore = { HOME: process.env.HOME, PATH: process.env.PATH };
      process.env.HOME = homeRoot;
      process.env.PATH = `${wrapperFolder}:${realFolder}:/usr/bin:/bin`;
      try {
        const host = yield* scanHost;

        expect(host.agentEvidence.commands).toContain("kimi");
        expect(host.agentEvidence.commands).not.toContain("grok");
      } finally {
        process.env.HOME = environmentBefore.HOME;
        process.env.PATH = environmentBefore.PATH;
        rmSync(homeRoot, { recursive: true, force: true });
      }
    }),
  );
});
