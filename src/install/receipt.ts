import { readFile } from "node:fs/promises";

import { z } from "zod";

import { addDependencies, featureIdSchema, retiredFeatureIds } from "../catalog/feature-catalog.js";
import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "../zod-issue-messages.js";
import { decodeStrictText, isNotFound, replaceBytesWithBase64 } from "./file-bytes.js";
import { findDuplicateJsonKey } from "./find-duplicate-json-key.js";
import { type OwnedFile, ownedFileSchema, pathsConflict } from "./ownership.js";
import { nonEmptyTrimmedTextSchema } from "./text-rules.js";

export const scopeSchema = z.enum(["global", "project"]).describe("Installation scope that owns the receipt.");

export type Scope = z.infer<typeof scopeSchema>;

// e.g. "0.12.1", "1.0.0-rc.1", "1.0.0+build.3"
export const versionSchema = nonEmptyTrimmedTextSchema.regex(
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "Receipt versions must use semantic version syntax.",
);

const ownedFileListIssues = (files: ReadonlyArray<OwnedFile>): Array<ZodIssueDetail> => [
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

// The receipt's own features in catalog order. A dependency the receipt does not list stays out of it.
const listRecordedFeatures = (features: ReadonlyArray<string>, featureIdsWithDependencies: ReadonlyArray<string>) =>
  featureIdsWithDependencies.filter((featureId) => features.includes(featureId));

const receiptFeatureIssues = (features: ReadonlyArray<string>): Array<ZodIssueDetail> => {
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
const withCurrentFeatureIds = (features: string[]): string[] => {
  const hasRetiredFeatureId = features.some((feature) => retiredFeatureIds.has(feature));
  if (!hasRetiredFeatureId) {
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
  .transform(withCurrentFeatureIds)
  .pipe(
    z
      .array(featureIdSchema)
      .superRefine((features, context) => addZodIssueDetails(context, receiptFeatureIssues(features))),
  );

export const receiptSchema = z
  .strictObject({
    version: versionSchema,
    scope: scopeSchema,
    features: featureListSchema,
    ownedFiles: z
      .array(ownedFileSchema)
      .superRefine((files, context) => addZodIssueDetails(context, ownedFileListIssues(files))),
  })
  .describe("Ownership receipt: everything one installation scope owns.");

export type Receipt = z.infer<typeof receiptSchema>;

export const encodeReceiptJson = (receipt: Receipt): string => {
  const checkedReceipt = receiptSchema.parse(receipt);

  return JSON.stringify(checkedReceipt, replaceBytesWithBase64);
};

export const decodeReceiptJson = (json: string): Receipt => {
  const parsedJson: unknown = JSON.parse(json);
  const receiptReply = receiptSchema.safeParse(parsedJson);
  if (!receiptReply.success) {
    throw new Error(joinZodIssueMessages(receiptReply.error));
  }

  return receiptReply.data;
};

const decodeReceiptBytes = (bytes: Uint8Array): Receipt => {
  const textReply = decodeStrictText(bytes, "receipt.json");
  const isTextInvalid = textReply._tag === "invalid";
  if (isTextInvalid) {
    throw new Error(textReply.message);
  }

  const duplicateProperty = findDuplicateJsonKey(textReply.fileContents);
  const isPropertyDuplicated = duplicateProperty !== undefined;
  if (isPropertyDuplicated) {
    throw new Error(`duplicate JSON property ${JSON.stringify(duplicateProperty)}`);
  }

  return decodeReceiptJson(textReply.fileContents);
};

export type ReceiptSnapshot = { _tag: "missing" } | { _tag: "present"; bytes: Uint8Array; receipt: Receipt };

const missingReceiptSnapshot: ReceiptSnapshot = { _tag: "missing" };

const readReceiptBytesOrNull = async (receiptPath: string): Promise<Uint8Array | null> => {
  try {
    return await readFile(receiptPath);
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
