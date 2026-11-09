import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeContext } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { featureCatalog } from "../catalog/feature-catalog.js";
import { preparePackage } from "./prepare-package.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compiledHooksRoot = path.join(packageRoot, "dist", "src", "hooks");
// preparePackage needs the compiled hooks (`pnpm build`); CI runs tests before they exist, and catalog casing is
// still covered without them.
const packageIsBuilt = existsSync(compiledHooksRoot);

// e.g. `from "../lib/hook-config.js"` or `import("./hook-output.js")` in a compiled runtime file
const RELATIVE_IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*)"(\.{1,2}\/[^"]+)"/g;

const unresolvedRuntimeImports = (preparedRuntimeRoot: string): ReadonlyArray<string> =>
  readdirSync(preparedRuntimeRoot, { recursive: true, encoding: "utf8" })
    .filter((relativePath) => relativePath.endsWith(".js"))
    .flatMap((relativePath) => {
      const preparedFile = path.join(preparedRuntimeRoot, relativePath);
      const specifiers = [...readFileSync(preparedFile, "utf8").matchAll(RELATIVE_IMPORT_PATTERN)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      );
      return specifiers
        .filter((specifier) => !existsSync(path.resolve(path.dirname(preparedFile), specifier)))
        .map((specifier) => `${relativePath} -> ${specifier}`);
    });

describe("preparePackage", () => {
  it("keeps authored source directories kebab-case and catalog-aligned", () => {
    // Assert the casing contract on every catalog entry, not just a sample.
    for (const feature of featureCatalog) {
      expect(feature.sourceDirectory).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    }
    expect(new Set(featureCatalog.map((feature) => feature.sourceDirectory)).size).toBe(featureCatalog.length);
  });

  it.effect.skipIf(!packageIsBuilt)(
    "prepares runtime entrypoints and commands whose imports resolve inside the prepared tree",
    () =>
      Effect.gen(function* () {
        const prepared = yield* preparePackage;
        expect(prepared.root.endsWith("/dist/prepared") || prepared.root.endsWith("\\dist\\prepared")).toBe(true);
        expect(prepared.version).toMatch(/^\d+\.\d+\.\d+/);

        const preparedRuntimeRoot = path.join(prepared.root, "hooks");
        expect(unresolvedRuntimeImports(preparedRuntimeRoot)).toEqual([]);

        const scratchFolderGuardRoot = path.join(preparedRuntimeRoot, "scratch-folder-guard");
        const scratchFolderGuard = path.join(scratchFolderGuardRoot, "hooks/scratch-folder-guard.js");
        expect(readFileSync(scratchFolderGuard, "utf8")).toContain("../lib/hook-config.js");
        expect(existsSync(path.join(scratchFolderGuardRoot, "lib/hook-config.js"))).toBe(true);
        expect(existsSync(path.join(scratchFolderGuardRoot, "lib/hook-output.js"))).toBe(true);
        expect(existsSync(path.join(scratchFolderGuardRoot, "watchers/scratch-watcher.js"))).toBe(true);
        expect(existsSync(path.join(scratchFolderGuardRoot, "command/clear-scratch.js"))).toBe(true);

        // scratch-folder-guard reads transcripts through the shared hook lib, so preparing copies it beside the hook.
        expect(existsSync(path.join(scratchFolderGuardRoot, "lib/transcript-reader.js"))).toBe(true);

        // The hook reads its transcript under HOME, so give it a throwaway one.
        const hookHome = mkdtempSync(path.join(tmpdir(), "agent-setup-prepared-home-"));
        try {
          const execution = spawnSync(process.execPath, [scratchFolderGuard], {
            input:
              '{"hook_event_name":"PreToolUse","session_id":"prepared-package-test","tool_name":"Bash","tool_input":{"command":"echo ok"}}',
            encoding: "utf8",
            env: { ...process.env, HOME: hookHome },
          });
          expect(execution.stderr).toBe("");
          expect(execution.status).toBe(0);
        } finally {
          rmSync(hookHome, { recursive: true, force: true });
        }
      }).pipe(Effect.provide(NodeContext.layer)),
    { timeout: 30_000 },
  );
});
