/** Plan the final unowned bytes of receipted files: what uninstall and update write back or remove. */

import { Path } from "@effect/platform";
import { Effect, Either, Schema, ParseResult as SchemaParseIssue } from "effect";

import { agentCatalog } from "../catalog/agent-catalog.js";
import { zodAsEffectSchema } from "../zod-as-effect-schema.js";
import { planInstructionFile } from "./agent-formats/instruction-file.js";
import { planInstructionLink } from "./agent-formats/instruction-link.js";
import { hashBytes } from "./file-bytes.js";
import { restoreSettings } from "./hook-settings.js";
import { checkFileChange, expectedCurrent, type FileSnapshot, readFileSnapshot } from "./host-files.js";
import { hooksPath } from "./install-paths.js";
import { createInstallError, wrapAsInstallError } from "./install-request.js";
import { type OwnedFile, ownedFileSchema } from "./ownership.js";
import { absoluteRootSchema, type FileChange } from "./plan.js";
import type { Receipt } from "./receipt.js";

type RestoreTarget = {
  readonly file: OwnedFile;
  readonly snapshot: FileSnapshot;
};

const restoreWholeFile = ({ file, snapshot }: RestoreTarget): Either.Either<FileChange, Error> => {
  if (file.ownership._tag !== "wholeFile") {
    return Either.left(createInstallError(`File ${file.path} requires a format-specific restoration.`));
  }

  const ownership = file.ownership;
  // We created this path from nothing, so uninstall must not stick on drift, upgrades, or prior deletion;
  // expectedCurrent still binds the transaction to the bytes observed at plan time.
  if (ownership.previous._tag === "missing") {
    return checkFileChange({
      _tag: "remove",
      file,
      unownedBytes: new Uint8Array(),
      expectedCurrent: expectedCurrent(snapshot),
    });
  }

  if (snapshot._tag === "missing" || hashBytes(snapshot.bytes) === ownership.installedHash) {
    return checkFileChange({
      _tag: "restore",
      file,
      bytes: ownership.previous.bytes,
      expectedCurrent: expectedCurrent(snapshot),
    });
  }

  return Either.left(createInstallError(`Receipted file ${file.path} changed after installation.`));
};

const checkFormatRestoration = (
  { file, snapshot, format }: RestoreTarget & { readonly format: string },
  plan: Either.Either<{ readonly _tag: string }, unknown>,
): Either.Either<FileChange, Error> =>
  Either.flatMap(Either.mapLeft(plan, wrapAsInstallError), (operation) =>
    operation._tag === "none"
      ? Either.left(createInstallError(`${format} restoration for ${file.path} returned no operation.`))
      : checkFileChange({ ...operation, expectedCurrent: expectedCurrent(snapshot) }),
  );

const restoreInstructionFile = (target: RestoreTarget) =>
  checkFormatRestoration(
    { ...target, format: "Instruction" },
    Either.try({
      try: () =>
        planInstructionFile({
          path: target.file.path,
          desired: { _tag: "absent" },
          currentFile: target.snapshot,
          previousFile: { _tag: "owned", file: target.file },
        }),
      catch: wrapAsInstallError,
    }),
  );

const restoreInstructionLink = (target: RestoreTarget): Either.Either<FileChange, Error> => {
  const { file } = target;
  if (file.owner._tag !== "agent" || file.owner.agentIds.length !== 1) {
    return Either.left(createInstallError(`Native config restoration for ${file.path} requires one agent owner.`));
  }

  const agentId = file.owner.agentIds.at(0);
  const agent = agentCatalog.find((candidate) => candidate.id === agentId);
  if (agent === undefined || agent.target._tag !== "instructionLink") {
    return Either.left(createInstallError(`Native config restoration for ${file.path} has no catalog agent.`));
  }

  return checkFormatRestoration(
    { ...target, format: "Native config" },
    planInstructionLink({
      agent,
      desired: { _tag: "absent" },
      currentFile: target.snapshot,
      previousFile: { _tag: "owned", file },
    }),
  );
};

const restoreRequestSchema = Schema.Struct({
  root: zodAsEffectSchema(absoluteRootSchema).annotations({
    description: "Canonical installation root containing the receipted files.",
  }),
  files: Schema.Array(zodAsEffectSchema(ownedFileSchema)).annotations({
    description: "Exact receipt entries whose final unowned state must be computed.",
  }),
}).annotations({
  description: "Receipt-authorized file restoration request with no detection authority.",
});

// Computes each receipted file's final unowned bytes without touching the filesystem.
export const planRestorations = (input: unknown) =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknown(restoreRequestSchema, { onExcessProperty: "error" })(input).pipe(
      Effect.mapError((error) => createInstallError(SchemaParseIssue.TreeFormatter.formatErrorSync(error))),
    );
    const path = yield* Path.Path;

    return yield* Effect.forEach(request.files, (file) =>
      Effect.gen(function* () {
        const target = { file, snapshot: yield* readFileSnapshot(path.join(request.root, file.path)) };
        switch (file.kind._tag) {
          case "instruction":
            return yield* restoreInstructionFile(target);
          case "instructionLink":
            return yield* restoreInstructionLink(target);
          case "settings":
            return yield* restoreSettings({ ...target, installedHooksFolder: path.join(request.root, hooksPath) });
          default:
            return yield* restoreWholeFile(target);
        }
      }),
    );
  }).pipe(Effect.mapError(wrapAsInstallError));

export const planStaleRestorations = (input: {
  root: string;
  previousReceipt: Receipt | undefined;
  desiredWrites: ReadonlyArray<FileChange>;
  settingsPlans: ReadonlyArray<FileChange>;
}) =>
  Effect.gen(function* () {
    if (input.previousReceipt === undefined) {
      return [];
    }

    const desiredPaths = new Set(input.desiredWrites.map((write) => write.file.path));
    const settingsRestorations = input.settingsPlans.filter((operation) => operation._tag !== "write");
    const settingsPaths = new Set(settingsRestorations.map((operation) => operation.file.path));
    const staleFiles = input.previousReceipt.ownedFiles.filter(
      (file) => !desiredPaths.has(file.path) && !settingsPaths.has(file.path),
    );

    return [...settingsRestorations, ...(yield* planRestorations({ root: input.root, files: staleFiles }))];
  });
