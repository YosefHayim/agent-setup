/** Host files as install sees them: snapshot, expected-current guard, prior value, and checked file change. */

import { FileSystem } from "@effect/platform";
import { Effect, Either, Schema, ParseResult as SchemaParseIssue } from "effect";

import { zodAsEffectSchema } from "../zod-as-effect-schema.js";
import { bytesEqual, hashBytes, isNotFound } from "./file-bytes.js";
import { createInstallError } from "./install-request.js";
import type { FileOwner, OwnedFile, PreviousFileValue } from "./ownership.js";
import { type ExpectedCurrent, type FileChange, fileChangeSchema } from "./plan.js";
import type { Receipt } from "./receipt.js";

export const applicationOwner = { _tag: "application" } as const satisfies FileOwner;

const fileSnapshotSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("file", {
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact bytes observed at one planned file path.",
    }),
  }),
);

export type FileSnapshot = Schema.Schema.Type<typeof fileSnapshotSchema>;

export const readFileSnapshot = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    return yield* fileSystem.readFile(filePath).pipe(
      Effect.map((bytes): FileSnapshot => ({ _tag: "file", bytes })),
      Effect.catchIf(isNotFound, (): Effect.Effect<FileSnapshot> => Effect.succeed({ _tag: "missing" })),
    );
  });

export const expectedCurrent = (snapshot: FileSnapshot): ExpectedCurrent =>
  snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", sha256: hashBytes(snapshot.bytes) };

export const previousFileValue = (snapshot: FileSnapshot): PreviousFileValue =>
  snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "priorFile", bytes: snapshot.bytes };

export const checkFileChange = (input: unknown): Either.Either<FileChange, Error> =>
  Either.mapLeft(
    Schema.validateEither(zodAsEffectSchema(fileChangeSchema), {
      onExcessProperty: "error",
    })(input),
    (error) =>
      createInstallError(`Generated file change is invalid: ${SchemaParseIssue.TreeFormatter.formatErrorSync(error)}`),
  );

export const previousReceiptFile = (receipt: Receipt | undefined, filePath: string): OwnedFile | undefined =>
  receipt?.ownedFiles.find((file) => file.path === filePath);

// A receipted file that already holds the bytes about to be written is adopted, not refused: an external
// skill sync can reproduce our content, and rewriting identical bytes destroys nothing.
export const previousWholeFile = (input: {
  receipt: Receipt | undefined;
  filePath: string;
  snapshot: FileSnapshot;
  desiredBytes?: Uint8Array;
}): Either.Either<PreviousFileValue, Error> => {
  const file = previousReceiptFile(input.receipt, input.filePath);
  if (file === undefined) {
    return Either.right(previousFileValue(input.snapshot));
  }

  if (file.ownership._tag !== "wholeFile") {
    return Either.left(createInstallError(`Receipted whole-file file ${input.filePath} has incompatible ownership.`));
  }

  const snapshot = input.snapshot;
  const installedContent = snapshot._tag === "file" && hashBytes(snapshot.bytes) === file.ownership.installedHash;
  const desiredContent =
    snapshot._tag === "file" && input.desiredBytes !== undefined && bytesEqual(snapshot.bytes, input.desiredBytes);
  if (!installedContent && !desiredContent) {
    return Either.left(createInstallError(`Receipted whole-file file ${input.filePath} changed after installation.`));
  }

  return Either.right(file.ownership.previous);
};
