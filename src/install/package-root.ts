/** The running agent-setup package: the nearest package.json above this module, and its version. */

import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema, ParseResult as SchemaParseIssue } from "effect";

import { versionSchema } from "./receipt.js";

class PackageRootError extends Schema.TaggedError<PackageRootError>()("PackageRootError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Why the running package's package.json could not be found or read.",
  }),
}) {
  get message(): string {
    return `Cannot read the agent-setup package: ${this.issue}`;
  }
}

const packageManifestSchema = Schema.parseJson(
  Schema.Struct({
    version: versionSchema.annotations({
      description: "Semantic package version published in the ownership receipt.",
    }),
  }),
);

// The same walk works from src/install (tsx) and dist/src/install (built package).
export const findPackageRoot = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const moduleDirectory = path.dirname(yield* path.fromFileUrl(new URL(import.meta.url)));
  let directory = moduleDirectory;
  while (true) {
    if (yield* fileSystem.exists(path.join(directory, "package.json"))) {
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return yield* new PackageRootError({ issue: `no package.json above ${moduleDirectory}.` });
    }

    directory = parent;
  }
});

export const readPackageVersion = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packageJsonPath = path.join(yield* findPackageRoot, "package.json");
  const manifestSource = yield* fileSystem
    .readFileString(packageJsonPath)
    .pipe(Effect.mapError((error) => new PackageRootError({ issue: `${packageJsonPath}: ${error.message}` })));
  const manifest = yield* Schema.decodeUnknown(packageManifestSchema)(manifestSource).pipe(
    Effect.mapError(
      (error) =>
        new PackageRootError({
          issue: `${packageJsonPath} has no valid version: ${SchemaParseIssue.TreeFormatter.formatErrorSync(error)}`,
        }),
    ),
  );

  return manifest.version;
});
