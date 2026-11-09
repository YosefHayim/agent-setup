/** The ownership receipt: the one file that records everything an installation owns, and its strict reader. */

import { FileSystem } from "@effect/platform";
import { Effect, Either, Option, Schema, ParseResult as SchemaParseIssue } from "effect";

import { addDependencies, featureIdSchema, retiredFeatureIds } from "../catalog/feature-catalog.js";
import { decodeStrictText, isNotFound } from "./file-bytes.js";
import { findDuplicateJsonKey } from "./find-duplicate-json-key.js";
import { type OwnedFile, ownedFileSchema, pathsConflict } from "./ownership.js";

export const scopeSchema = Schema.Literal("global", "project").annotations({
  description: "Installation scope that owns the receipt.",
});

export type Scope = Schema.Schema.Type<typeof scopeSchema>;

// e.g. "0.12.1", "1.0.0-rc.1", "1.0.0+build.3"
const SEMVER_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const ownedFileListIssues = (files: ReadonlyArray<OwnedFile>) => [
  ...files.flatMap((file, index) =>
    files.slice(index + 1).flatMap((candidate, offset) =>
      pathsConflict(file.path, candidate.path)
        ? [
            {
              path: [index + offset + 1, "path"],
              message: `Owned file path ${candidate.path} conflicts with ${file.path}.`,
            },
          ]
        : [],
    ),
  ),
  ...files.flatMap((file, index) =>
    file.kind._tag === "receipt"
      ? [{ path: [index, "kind"], message: "A receipt cannot record ownership of itself." }]
      : [],
  ),
];

const ownedFileListSchema = Schema.Array(ownedFileSchema).pipe(Schema.filter(ownedFileListIssues));

// The receipt's own features in catalog order. A dependency the receipt does not list stays out of it.
const listRecordedFeatures = (features: ReadonlyArray<string>, resolvedIds: ReadonlyArray<string>) =>
  resolvedIds.filter((featureId) => features.includes(featureId));

const receiptFeatureIssues = (features: ReadonlyArray<string>) => {
  const resolved = addDependencies(features);
  if (Either.isLeft(resolved)) {
    const featureId = resolved.left.featureId;
    return [{ path: [features.indexOf(featureId)], message: `Receipt feature ${featureId} is unknown.` }];
  }

  const catalogOrderFeatures = listRecordedFeatures(features, resolved.right);
  const mismatchIndex = features.findIndex((feature, index) => feature !== catalogOrderFeatures[index]);
  const isOrderWrong = mismatchIndex >= 0 || features.length !== catalogOrderFeatures.length;
  if (isOrderWrong) {
    return [
      {
        path: [mismatchIndex >= 0 ? mismatchIndex : features.length],
        message: "Receipt features must be unique and in catalog order.",
      },
    ];
  }

  return [];
};

// A receipt from before a feature merge reads as the feature that replaced the retired ID.
const withCurrentFeatureIds = (features: ReadonlyArray<string>) => {
  if (!features.some((feature) => retiredFeatureIds.has(feature))) return features;
  const renamed = features.map((feature) => retiredFeatureIds.get(feature) || feature);
  const resolved = addDependencies(renamed);
  if (Either.isLeft(resolved)) return renamed;

  return listRecordedFeatures(renamed, resolved.right);
};

const featureListSchema = Schema.transform(
  Schema.Array(Schema.String),
  Schema.Array(featureIdSchema).pipe(Schema.filter(receiptFeatureIssues)),
  { strict: true, decode: withCurrentFeatureIds, encode: (features) => features },
);

export const versionSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(SEMVER_PATTERN, {
    message: () => "Receipt versions must use semantic version syntax.",
  }),
);

export const receiptSchema = Schema.Struct({
  version: versionSchema,
  scope: scopeSchema,
  features: featureListSchema,
  ownedFiles: ownedFileListSchema,
});

export type Receipt = Schema.Schema.Type<typeof receiptSchema>;

export const receiptJsonSchema = Schema.parseJson(receiptSchema);

export const decodeReceiptJson = Schema.decodeUnknown(receiptJsonSchema, {
  onExcessProperty: "error",
});

const decodeReceiptBytes = (bytes: Uint8Array): Either.Either<Receipt, string> =>
  Either.flatMap(decodeStrictText(bytes, "receipt.json"), (json) => {
    const duplicateProperty = findDuplicateJsonKey(json);
    if (duplicateProperty !== undefined) {
      return Either.left(`duplicate JSON property ${JSON.stringify(duplicateProperty)}`);
    }

    return Either.mapLeft(
      Schema.decodeUnknownEither(receiptJsonSchema, { onExcessProperty: "error" })(json),
      SchemaParseIssue.TreeFormatter.formatErrorSync,
    );
  });

const receiptSnapshotSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("present", {
    bytes: Schema.Uint8ArrayFromSelf.annotations({
      description: "Exact receipt file bytes read from disk.",
    }),
    receipt: Schema.typeSchema(receiptSchema).annotations({
      description: "Strict receipt decoded from the same file bytes.",
    }),
  }),
).annotations({
  description: "Missing or strictly decoded receipt with its exact source bytes.",
});

export type ReceiptSnapshot = Schema.Schema.Type<typeof receiptSnapshotSchema>;

export class ReceiptParseError extends Schema.TaggedError<ReceiptParseError>()("ReceiptParseError", {
  receiptPath: Schema.NonEmptyString.annotations({
    description: "Receipt file whose contents could not be decoded.",
  }),
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable receipt encoding, JSON, or schema issue.",
  }),
}) {
  get message(): string {
    return `Receipt at ${this.receiptPath} is invalid: ${this.issue}. Fix or remove it, then retry.`;
  }
}

const missingReceiptSnapshot: ReceiptSnapshot = { _tag: "missing" };

export const readReceipt = (receiptPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFile(receiptPath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
    );
    if (Option.isNone(contents)) {
      return missingReceiptSnapshot;
    }

    const receipt = decodeReceiptBytes(contents.value);
    if (Either.isLeft(receipt)) {
      return yield* new ReceiptParseError({ receiptPath, issue: receipt.left });
    }

    return { _tag: "present", bytes: contents.value, receipt: receipt.right } satisfies ReceiptSnapshot;
  });
