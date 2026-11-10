// Prepare the package that install, update, and doctor read: compiled hook code from dist/src/hooks/<sourceDirectory>/
// goes to dist/prepared/hooks/<sourceDirectory>/, and each catalog skill allowlist to dist/prepared/skills/<id>/.

import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect, Schema } from "effect";

import { featureCatalog } from "../catalog/feature-catalog.js";
import { type PreparedPackage, readErrorMessage } from "./install-request.js";
import { findPackageRoot, readPackageVersion } from "./package-root.js";

class PreparePackageError extends Schema.TaggedError<PreparePackageError>()("PreparePackageError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable package preparation failure describing what the operator should fix.",
  }),
}) {
  get message(): string {
    return `Cannot prepare agent-setup package: ${this.issue}`;
  }
}

const copyFile = (input: { source: string; destination: string }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(path.dirname(input.destination), { recursive: true });
    yield* fileSystem.writeFile(input.destination, yield* fileSystem.readFile(input.source));
  });

// Never copy install junk even when a catalog path is a directory allowlist.
const SKIPPED_TREE_NAMES = new Set(["node_modules", ".playwright", "out", ".git", ".DS_Store"]);

const copyTree = (input: {
  source: string;
  destination: string;
}): Effect.Effect<void, PreparePackageError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fileSystem.exists(input.source))) {
      return;
    }

    const sourceStat = yield* fileSystem.stat(input.source);
    if (sourceStat.type === "File") {
      yield* copyFile(input);
      return;
    }

    if (sourceStat.type !== "Directory") {
      return;
    }

    yield* fileSystem.makeDirectory(input.destination, { recursive: true });
    for (const entry of yield* fileSystem.readDirectory(input.source)) {
      if (!SKIPPED_TREE_NAMES.has(entry)) {
        yield* copyTree({ source: path.join(input.source, entry), destination: path.join(input.destination, entry) });
      }
    }
  });

// The shared hook lib is copied into each feature's lib/, so tsc's src/hooks/lib specifier becomes a
// sibling of lib/ for hooks, watchers, and commands, and a same-folder import for lib files themselves.
// e.g. "../../lib/hook-config.js" from src/hooks/<feature>/hooks/ or src/hooks/<feature>/lib/
const SHARED_HOOK_LIB_IMPORT = "../../lib/";

const RUNTIME_IMPORT_PARTS: ReadonlyArray<{ readonly part: string; readonly runtimeImport: string }> = [
  { part: "hooks", runtimeImport: "../lib/" },
  { part: "watchers", runtimeImport: "../lib/" },
  { part: "command", runtimeImport: "../lib/" },
  { part: "lib", runtimeImport: "./" },
];

const rewriteSharedLibImports = (input: { partRoot: string; runtimeImport: string }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fileSystem.exists(input.partRoot))) {
      return false;
    }

    const preparedFiles = (yield* fileSystem.readDirectory(input.partRoot)).filter((name) => name.endsWith(".js"));
    const sharedRuntimeImports = yield* Effect.forEach(preparedFiles, (name) =>
      Effect.gen(function* () {
        const preparedPath = path.join(input.partRoot, name);
        const source = yield* fileSystem.readFileString(preparedPath);
        const usesSharedRuntime = source.includes(SHARED_HOOK_LIB_IMPORT);
        if (usesSharedRuntime) {
          yield* fileSystem.writeFileString(
            preparedPath,
            source.replaceAll(SHARED_HOOK_LIB_IMPORT, input.runtimeImport),
          );
        }
        return usesSharedRuntime;
      }),
    );
    return sharedRuntimeImports.some(Boolean);
  });

const copyHookFeature = (input: { packageRoot: string; preparedRoot: string; sourceDirectory: string }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const compiledFeatureRoot = path.join(input.packageRoot, "dist", "src", "hooks", input.sourceDirectory);
    const preparedFeatureRoot = path.join(input.preparedRoot, "hooks", input.sourceDirectory);
    if (!(yield* fileSystem.exists(compiledFeatureRoot))) {
      return;
    }

    for (const part of ["hooks", "watchers", "lib", "command"]) {
      yield* copyTree({
        source: path.join(compiledFeatureRoot, part),
        destination: path.join(preparedFeatureRoot, part),
      });
    }

    const sharedRuntimeUsers = yield* Effect.forEach(RUNTIME_IMPORT_PARTS, ({ part, runtimeImport }) =>
      rewriteSharedLibImports({ partRoot: path.join(preparedFeatureRoot, part), runtimeImport }),
    );
    if (sharedRuntimeUsers.some(Boolean)) {
      yield* copyTree({
        source: path.join(input.packageRoot, "dist", "src", "hooks", "lib"),
        destination: path.join(preparedFeatureRoot, "lib"),
      });
    }
  });

const copySkillFeature = (input: {
  packageRoot: string;
  preparedRoot: string;
  sourceDirectory: string;
  skillId: string;
  shippedPaths: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillSourceRoot = path.join(input.packageRoot, "src", "skills", input.sourceDirectory);
    if (!(yield* fileSystem.exists(skillSourceRoot))) {
      return yield* new PreparePackageError({ issue: `Authored skill directory missing at ${skillSourceRoot}.` });
    }

    for (const shippedPath of input.shippedPaths) {
      const source = path.join(skillSourceRoot, shippedPath);
      if (!(yield* fileSystem.exists(source))) {
        return yield* new PreparePackageError({
          issue: `Catalog-shipped path ${shippedPath} is missing under ${skillSourceRoot}.`,
        });
      }

      yield* copyTree({ source, destination: path.join(input.preparedRoot, "skills", input.skillId, shippedPath) });
    }
  });

export const preparePackage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packageRoot = yield* Effect.tryPromise({
    try: findPackageRoot,
    catch: (error) => new PreparePackageError({ issue: readErrorMessage(error) }),
  });
  const compiledHooksRoot = path.join(packageRoot, "dist", "src", "hooks");
  if (!(yield* fileSystem.exists(compiledHooksRoot))) {
    return yield* new PreparePackageError({
      issue: `Compiled hooks missing at ${compiledHooksRoot}. Run \`pnpm build\` before install, update, or doctor.`,
    });
  }

  const version = yield* Effect.tryPromise({
    try: readPackageVersion,
    catch: (error) => new PreparePackageError({ issue: readErrorMessage(error) }),
  });
  const preparedRoot = path.join(packageRoot, "dist", "prepared");
  yield* fileSystem.remove(preparedRoot, { recursive: true }).pipe(Effect.catchAll(() => Effect.void));
  yield* fileSystem.makeDirectory(path.join(preparedRoot, "hooks"), { recursive: true });
  yield* fileSystem.makeDirectory(path.join(preparedRoot, "skills"), { recursive: true });

  for (const feature of featureCatalog) {
    if (feature.runtime._tag === "hook") {
      yield* copyHookFeature({
        packageRoot,
        preparedRoot,
        sourceDirectory: feature.sourceDirectory,
      });
    }

    if (feature.installedSkill._tag === "skill") {
      yield* copySkillFeature({
        packageRoot,
        preparedRoot,
        sourceDirectory: feature.sourceDirectory,
        skillId: feature.installedSkill.id,
        shippedPaths: feature.installedSkill.shippedPaths,
      });
    }
  }

  return { root: preparedRoot, version } satisfies PreparedPackage;
});
