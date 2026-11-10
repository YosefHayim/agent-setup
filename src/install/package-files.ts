/** Files the prepared package ships: hook code and skill trees read from the prepared folder and planned as whole-file writes. */

import { FileSystem, Path } from "@effect/platform";
import { Effect, ParseResult, Schema } from "effect";
import type { z } from "zod";

import { type FeatureId, featureCatalog, installedSkillSchema, skillsForFeatures } from "../catalog/feature-catalog.js";
import { zodAsEffectSchema } from "../zod-as-effect-schema.js";
import { decodeStrictText, hashBytes } from "./file-bytes.js";
import {
  applicationOwner,
  checkFileChange,
  expectedCurrent,
  previousWholeFile,
  readFileSnapshot,
} from "./host-files.js";
import { hooksPath } from "./install-paths.js";
import { InstallError, type InstallRequest } from "./install-request.js";
import type { Receipt } from "./receipt.js";

const preparedFileSchema = Schema.Struct({
  path: Schema.NonEmptyTrimmedString.annotations({
    description: "Feature-runtime-relative prepared file path.",
  }),
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact prepared runtime bytes copied into the installation.",
  }),
});

type PreparedFile = Schema.Schema.Type<typeof preparedFileSchema>;

const isUnderShippedPath = (filePath: string, shippedPath: string): boolean =>
  filePath === shippedPath || filePath.startsWith(`${shippedPath}/`);

const preparedSkillPathIssues = (preparedSkill: {
  installedSkill: z.infer<typeof installedSkillSchema>;
  sourceFiles: ReadonlyArray<PreparedFile>;
}) => [
  ...preparedSkill.sourceFiles.flatMap((sourceFile, index) =>
    preparedSkill.installedSkill.shippedPaths.some((shippedPath) => isUnderShippedPath(sourceFile.path, shippedPath))
      ? []
      : [
          {
            path: ["sourceFiles", index, "path"],
            message: `Prepared skill file ${sourceFile.path} is not catalog-shipped.`,
          },
        ],
  ),
  ...preparedSkill.installedSkill.shippedPaths.flatMap((shippedPath, index) =>
    preparedSkill.sourceFiles.some((sourceFile) => isUnderShippedPath(sourceFile.path, shippedPath))
      ? []
      : [
          {
            path: ["installedSkill", "shippedPaths", index],
            message: `Catalog-shipped path ${shippedPath} is missing from the prepared skill.`,
          },
        ],
  ),
];

const preparedSkillSchema = Schema.Struct({
  installedSkill: zodAsEffectSchema(installedSkillSchema).annotations({
    description: "Catalog skill identity paired with its verified prepared files.",
  }),
  sourceFiles: Schema.Array(preparedFileSchema).annotations({
    description: "Complete verified prepared skill file tree.",
  }),
  markdown: Schema.NonEmptyString.annotations({
    description: "Strict UTF-8 SKILL.md text used by native rule and instruction formats.",
  }),
}).pipe(Schema.filter(preparedSkillPathIssues));

export type PreparedSkill = Schema.Schema.Type<typeof preparedSkillSchema>;

export const installedHookFile = (sourceDirectory: string, filePath: string): string =>
  `${hooksPath}/${sourceDirectory}/${filePath}`;

// The compiled .js path a hook registration runs, relative to its feature's prepared hook folder.
export const registrationEntrypoint = (
  runtime: { readonly sourceEntrypoint: string },
  registration: { readonly entrypoint: { _tag: "featureDefault" } | { _tag: "path"; value: string } },
): string => {
  const sourceEntrypoint =
    registration.entrypoint._tag === "path" ? registration.entrypoint.value : runtime.sourceEntrypoint;

  return `${sourceEntrypoint.slice(0, -3)}.js`;
};

const readPreparedFiles = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = (yield* fileSystem.readDirectory(directory, { recursive: true })).sort();
    const files = yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        const sourcePath = path.join(directory, entry);
        const { type } = yield* fileSystem.stat(sourcePath);
        if (type === "Directory") {
          return [];
        }

        if (type !== "File") {
          return yield* new InstallError({ issue: `Prepared path ${sourcePath} must be a regular file.` });
        }

        return [{ path: entry.replaceAll("\\", "/"), bytes: yield* fileSystem.readFile(sourcePath) }];
      }),
    );

    return files.flat();
  });

const createHookFileWrite = (input: {
  request: InstallRequest;
  previousReceipt: Receipt | undefined;
  filePath: string;
  bytes: Uint8Array;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const snapshot = yield* readFileSnapshot(path.join(input.request.destination.root, input.filePath));
    const previous = yield* previousWholeFile({
      receipt: input.previousReceipt,
      filePath: input.filePath,
      snapshot,
      desiredBytes: input.bytes,
    });

    return yield* checkFileChange({
      _tag: "write",
      file: {
        owner: applicationOwner,
        path: input.filePath,
        kind: { _tag: "runtime" },
        ownership: { _tag: "wholeFile", installedHash: hashBytes(input.bytes), previous },
      },
      bytes: input.bytes,
      expectedCurrent: expectedCurrent(snapshot),
    });
  });

export const createHookWrites = (input: {
  request: InstallRequest;
  featureIds: ReadonlyArray<string>;
  previousReceipt: Receipt | undefined;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const hookFeatures = featureCatalog.flatMap((feature) =>
      input.featureIds.includes(feature.id) && feature.runtime._tag === "hook"
        ? [{ sourceDirectory: feature.sourceDirectory, runtime: feature.runtime }]
        : [],
    );
    const writes = yield* Effect.forEach(hookFeatures, ({ sourceDirectory, runtime }) =>
      Effect.gen(function* () {
        const files = yield* readPreparedFiles(path.join(input.request.preparedPackage.root, "hooks", sourceDirectory));
        for (const registration of runtime.registrations) {
          const entrypoint = registrationEntrypoint(runtime, registration);
          if (!files.some((file) => file.path === entrypoint)) {
            return yield* new InstallError({
              issue: `Prepared runtime entrypoint is missing: ${sourceDirectory}/${entrypoint}`,
            });
          }
        }

        return yield* Effect.forEach(files, (file) =>
          createHookFileWrite({
            request: input.request,
            previousReceipt: input.previousReceipt,
            filePath: installedHookFile(sourceDirectory, file.path),
            bytes: file.bytes,
          }),
        );
      }),
    );

    return writes.flat();
  });

export const readPreparedSkills = (input: { request: InstallRequest; featureIds: ReadonlyArray<FeatureId> }) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    return yield* Effect.forEach(skillsForFeatures(input.featureIds), (installedSkill) =>
      Effect.gen(function* () {
        const directory = path.join(input.request.preparedPackage.root, "skills", installedSkill.id);
        const sourceFiles = yield* readPreparedFiles(directory);
        const skillFile = sourceFiles.find((file) => file.path === "SKILL.md");
        if (skillFile === undefined) {
          return yield* new InstallError({ issue: `Prepared skill ${installedSkill.id} is missing SKILL.md.` });
        }

        const markdownReply = decodeStrictText(skillFile.bytes, path.join(directory, "SKILL.md"));
        const isMarkdownInvalid = markdownReply._tag === "invalid";
        if (isMarkdownInvalid) {
          return yield* new InstallError({ issue: markdownReply.message });
        }

        const markdown = markdownReply.fileContents;

        return yield* Schema.validate(preparedSkillSchema, { onExcessProperty: "error" })({
          installedSkill,
          sourceFiles,
          markdown,
        }).pipe(
          Effect.mapError(
            (error) =>
              new InstallError({
                issue: `Prepared skill ${installedSkill.id} is invalid: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
              }),
          ),
        );
      }),
    );
  });
