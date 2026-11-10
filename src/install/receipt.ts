import { readFile } from "node:fs/promises";

import { z } from "zod";

import { addDependencies, featureIdSchema, retiredFeatureIds } from "#src/catalog/feature-catalog.js";
import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "#src/zod-issue-messages.js";
import { decodeStrictString, isNotFound, replaceBytesWithBase64 } from "./file-bytes.js";
import { findDuplicateJsonKey } from "./find-duplicate-json-key.js";
import { isPathsConflict, type OwnedFile, ownedFileSchema } from "./ownership.js";
import { nonEmptyTrimmedTextSchema } from "./text-rules.js";

export const scopeSchema = z.enum(["global", "project"]).describe("Installation scope that owns the receipt.");

export type Scope = z.infer<typeof scopeSchema>;

// e.g. "0.12.1", "1.0.0-rc.1", "1.0.0+build.3"
export const versionSchema = nonEmptyTrimmedTextSchema.regex(
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "Receipt versions must use semantic version syntax.",
);

const listOwnedFileListIssues = (files: ReadonlyArray<OwnedFile>): Array<ZodIssueDetail> => [
  ...files.flatMap((file, index) =>
    files.slice(index + 1).flatMap((candidate, offset) =>
      isPathsConflict(file.path, candidate.path)
        ? [
            {
              path: [index + offset + 1, "path"],
              message: `Owned file path ${candidate.path} conflicts with ${file.path}.`,
            },
          ]
        : [],
    ),
  ),
  ...files.flatMap((file, index) => {
    const isReceiptKind = file.kind._tag === "receipt";
    return isReceiptKind ? [{ path: [index, "kind"], message: "A receipt cannot record ownership of itself." }] : [];
  }),
];

// The receipt's own features in catalog order. A dependency the receipt does not list stays out of it.
const listRecordedFeatures = (features: ReadonlyArray<string>, featureIdsWithCollaborators: ReadonlyArray<string>) =>
  featureIdsWithCollaborators.filter((featureId) => features.includes(featureId));

const listReceiptFeatureIssues = (features: ReadonlyArray<string>): Array<ZodIssueDetail> => {
  const dependencyCheck = addDependencies(features);

  const isFeatureUnknown = dependencyCheck.status === "unknown";
  if (isFeatureUnknown) {
    const featureId = dependencyCheck.featureId;

    return [{ path: [features.indexOf(featureId)], message: `Receipt feature ${featureId} is unknown.` }];
  }

  const catalogOrderFeatures = listRecordedFeatures(features, dependencyCheck.featureIds);
  const mismatchIndex = features.findIndex((feature, index) => feature !== catalogOrderFeatures[index]);

  const isOrderWrong = mismatchIndex >= 0 || features.length !== catalogOrderFeatures.length;
  if (isOrderWrong) {
    const hasMismatch = mismatchIndex >= 0;
    return [
      {
        path: [hasMismatch ? mismatchIndex : features.length],
        message: "Receipt features must be unique and in catalog order.",
      },
    ];
  }

  return [];
};

// A receipt from before a feature merge reads as the feature that replaced the retired ID.
const listWithCurrentFeatureIds = (features: string[]): string[] => {
  const hasRetiredFeatureId = features.some((feature) => retiredFeatureIds.has(feature));

  const isFeatureListCurrent = !hasRetiredFeatureId;
  if (isFeatureListCurrent) {
    return features;
  }

  const renamedFeatures = features.map((feature) => retiredFeatureIds.get(feature) || feature);
  const dependencyCheck = addDependencies(renamedFeatures);

  const isFeatureUnknown = dependencyCheck.status === "unknown";
  if (isFeatureUnknown) {
    return renamedFeatures;
  }

  return listRecordedFeatures(renamedFeatures, dependencyCheck.featureIds);
};

const featureListSchema = z
  .array(z.string())
  .transform(listWithCurrentFeatureIds)
  .pipe(
    z
      .array(featureIdSchema)
      .superRefine((features, scope) => addZodIssueDetails(scope, listReceiptFeatureIssues(features))),
  );

export const receiptSchema = z
  .strictObject({
    version: versionSchema,
    scope: scopeSchema,
    features: featureListSchema,
    ownedFiles: z
      .array(ownedFileSchema)
      .superRefine((files, scope) => addZodIssueDetails(scope, listOwnedFileListIssues(files))),
  })
  .describe("Ownership receipt: everything one installation scope owns.");

export type Receipt = z.infer<typeof receiptSchema>;

export const encodeReceiptDocument = (receipt: Receipt): string => {
  const checkedReceipt = receiptSchema.parse(receipt);

  return JSON.stringify(checkedReceipt, replaceBytesWithBase64);
};

export const decodeReceiptDocument = (document: string): Receipt => {
  const parsedDocument: unknown = JSON.parse(document);
  const receiptReply = receiptSchema.safeParse(parsedDocument);

  const isReceiptInvalid = !receiptReply.success;
  if (isReceiptInvalid) {
    throw new Error(joinZodIssueMessages(receiptReply.error));
  }

  return receiptReply.data;
};

const decodeReceiptBytes = (bytes: Uint8Array): Receipt => {
  const stringReply = decodeStrictString(bytes, "receipt.json");

  const isStringInvalid = stringReply._tag === "invalid";
  if (isStringInvalid) {
    throw new Error(stringReply.message);
  }

  const duplicateProperty = findDuplicateJsonKey(stringReply.fileContents);

  const isPropertyDuplicated = duplicateProperty != null;
  if (isPropertyDuplicated) {
    throw new Error(`duplicate JSON property ${JSON.stringify(duplicateProperty)}`);
  }

  return decodeReceiptDocument(stringReply.fileContents);
};

export type ReceiptSnapshot = { _tag: "missing" } | { _tag: "present"; bytes: Uint8Array; receipt: Receipt };

const missingReceiptSnapshot: ReceiptSnapshot = { _tag: "missing" };

const readReceiptBytesOrNull = async (receiptPath: string): Promise<Uint8Array | null> => {
  try {
    const receiptFileBytes = await readFile(receiptPath);

    return new Uint8Array(receiptFileBytes);
  } catch (error) {
    const isReceiptMissing = isNotFound(error);
    if (isReceiptMissing) {
      return null;
    }

    throw error;
  }
};

const readReceiptFromBytes = (receiptPath: string, bytes: Uint8Array): ReceiptSnapshot => {
  try {
    const receipt = decodeReceiptBytes(bytes);

    return { _tag: "present", bytes, receipt };
  } catch (error) {
    const isErrorObject = error instanceof Error;
    const issue = isErrorObject ? error.message : String(error);

    throw new Error(`Receipt at ${receiptPath} is invalid: ${issue}. Fix or remove it, then retry.`, { cause: error });
  }
};

export const readReceipt = async (receiptPath: string): Promise<ReceiptSnapshot> => {
  const receiptBytes = await readReceiptBytesOrNull(receiptPath);

  const isReceiptMissing = receiptBytes === null;
  if (isReceiptMissing) {
    return missingReceiptSnapshot;
  }

  return readReceiptFromBytes(receiptPath, receiptBytes);
};
