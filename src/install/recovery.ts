import { z } from "zod";

import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "#src/zod-issue-messages.js";
import { nonEmptyTrimmedTextSchema } from "./text-rules.js";

const readPortablePath = (filePath: string): string => filePath.replaceAll("\\", "/");

const readNormalizedRecoveryPath = (filePath: string): string => {
  const normalized = readPortablePath(filePath);

  const hasTrailingSlashToTrim = normalized.endsWith("/") && normalized !== "/" && !/^[A-Za-z]:\/$/.test(normalized);
  return hasTrailingSlashToTrim ? normalized.slice(0, -1) : normalized;
};

const readChildPathPrefix = (root: string): string => {
  const hasRootTrailingSlash = root.endsWith("/");
  return hasRootTrailingSlash ? root : `${root}/`;
};

const transactionDirectoryNamePattern =
  /^\.agent-setup-transaction-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isCanonicalAbsolutePath = (filePath: string): boolean => {
  const isDriveQualified = /^[A-Za-z]:[\\/]/.test(filePath);

  const isUnsafeFilePath =
    filePath.includes("\0") || (!isDriveQualified && (!filePath.startsWith("/") || filePath.includes("\\")));
  if (isUnsafeFilePath) {
    return false;
  }

  const remainder = isDriveQualified ? readPortablePath(filePath).slice(3) : filePath.slice(1);
  return remainder === "" || remainder.split("/").every((part) => part !== "" && part !== "." && part !== "..");
};

export const isInsideFolder = (root: string, candidate: string): boolean => {
  const normalizedRoot = readNormalizedRecoveryPath(root);
  const normalizedCandidate = readNormalizedRecoveryPath(candidate);

  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(readChildPathPrefix(normalizedRoot));
};

const readRecoveryPathKey = (filePath: string): string => readNormalizedRecoveryPath(filePath).toLowerCase();

const isRecoveryPathsConflict = (left: string, right: string): boolean => {
  const leftKey = readRecoveryPathKey(left);
  const rightKey = readRecoveryPathKey(right);

  return (
    leftKey === rightKey ||
    leftKey.startsWith(readChildPathPrefix(rightKey)) ||
    rightKey.startsWith(readChildPathPrefix(leftKey))
  );
};

const readRecoveryMarkerPath = (receiptPath: string): string => {
  const normalizedReceiptPath = readNormalizedRecoveryPath(receiptPath);

  return `${normalizedReceiptPath.slice(0, normalizedReceiptPath.lastIndexOf("/"))}/recovery.json`;
};

const isDirectSnapshotPath = (transactionRoot: string, snapshotPath: string): boolean => {
  const snapshotsPrefix = `${readChildPathPrefix(readNormalizedRecoveryPath(transactionRoot))}snapshots/`;
  const normalizedSnapshotPath = readNormalizedRecoveryPath(snapshotPath);

  const isInsideSnapshots = normalizedSnapshotPath.startsWith(snapshotsPrefix);
  const snapshotName = isInsideSnapshots ? normalizedSnapshotPath.slice(snapshotsPrefix.length) : "";

  return snapshotName !== "" && !snapshotName.includes("/");
};

const absolutePathSchema = nonEmptyTrimmedTextSchema.refine(isCanonicalAbsolutePath, {
  message: "Filesystem paths must be canonical absolute POSIX or drive-qualified paths.",
});

export const createUnfinishedChangeError = (recoveryPath: string): Error =>
  new Error(`Recovery is pending at ${recoveryPath}`);

const targetSnapshotSchema = z.strictObject({
  targetPath: absolutePathSchema.describe("Absolute destination path captured before the transaction mutated it."),
  original: z
    .discriminatedUnion("_tag", [
      z.strictObject({ _tag: z.literal("missing") }),
      z.strictObject({
        _tag: z.literal("file"),
        snapshotPath: absolutePathSchema.describe("Absolute path of the durable byte-for-byte target snapshot."),
      }),
    ])
    .describe("Whether the destination was absent or captured as a durable file snapshot."),
});

export type TargetSnapshot = z.infer<typeof targetSnapshotSchema>;

const recoveryObjectFieldsSchema = z.strictObject({
  _tag: z.literal("pending"),
  version: z.literal(1).describe("Recovery record format version."),
  root: absolutePathSchema.describe("Absolute installation root of the failed transaction."),
  receiptPath: absolutePathSchema.describe("Absolute ownership receipt path protected by the pending transaction."),
  transactionRoot: absolutePathSchema.describe("Retained transaction directory containing the durable snapshots."),
  snapshots: z
    .array(targetSnapshotSchema)
    .min(1, "Pending recovery records require at least one captured target.")
    .describe("Original state of every target captured before the transaction lock was published."),
});

type RecoveryObjectFields = z.infer<typeof recoveryObjectFieldsSchema>;

const checkReceiptPath = (stored: RecoveryObjectFields): ZodIssueDetail | null => {
  const isReceiptPathValid =
    isInsideFolder(stored.root, stored.receiptPath) && readPortablePath(stored.receiptPath).endsWith("/receipt.json");
  if (isReceiptPathValid) {
    return null;
  }

  return {
    path: ["receiptPath"],
    message: "Recovery receipt paths must stay under the decoded root and end in receipt.json.",
  };
};

const checkTransactionRoot = (stored: RecoveryObjectFields): ZodIssueDetail | null => {
  const transactionName = readNormalizedRecoveryPath(stored.transactionRoot).slice(
    readChildPathPrefix(readNormalizedRecoveryPath(stored.root)).length,
  );

  const isTransactionRootValid =
    isInsideFolder(stored.root, stored.transactionRoot) && transactionDirectoryNamePattern.test(transactionName);
  if (isTransactionRootValid) {
    return null;
  }

  return {
    path: ["transactionRoot"],
    message: "Recovery transaction roots must be direct reserved children of the decoded root.",
  };
};

const checkTargetPaths = (stored: RecoveryObjectFields): ZodIssueDetail | null => {
  const markerPath = readRecoveryMarkerPath(stored.receiptPath);
  const invalidIndex = stored.snapshots.findIndex(
    (snapshot) =>
      !isInsideFolder(stored.root, snapshot.targetPath) ||
      readNormalizedRecoveryPath(snapshot.targetPath) === readNormalizedRecoveryPath(stored.root) ||
      isRecoveryPathsConflict(snapshot.targetPath, markerPath) ||
      isRecoveryPathsConflict(stored.transactionRoot, snapshot.targetPath),
  );

  const isThereNoInvalidIndex = invalidIndex < 0;
  if (isThereNoInvalidIndex) {
    return null;
  }

  return {
    path: ["snapshots", invalidIndex, "targetPath"],
    message: "Recovery targets must stay below the decoded root and outside transaction-owned paths.",
  };
};

const checkSnapshotPaths = (stored: RecoveryObjectFields): ZodIssueDetail | null => {
  const invalidIndex = stored.snapshots.findIndex(
    (snapshot) =>
      snapshot.original._tag === "file" &&
      !isDirectSnapshotPath(stored.transactionRoot, snapshot.original.snapshotPath),
  );

  const isThereNoInvalidIndex = invalidIndex < 0;
  if (isThereNoInvalidIndex) {
    return null;
  }

  return {
    path: ["snapshots", invalidIndex, "original", "snapshotPath"],
    message: "Recovery snapshots must be direct children of the transaction snapshots directory.",
  };
};

const checkUniqueTargets = (stored: RecoveryObjectFields): ZodIssueDetail | null => {
  const targetPaths = stored.snapshots.map((snapshot) => snapshot.targetPath);
  const conflictingIndex = targetPaths.findIndex((candidate, index) =>
    targetPaths.slice(0, index).some((prior) => isRecoveryPathsConflict(prior, candidate)),
  );

  const isThereNoConflictingIndex = conflictingIndex < 0;
  if (isThereNoConflictingIndex) {
    return null;
  }

  return {
    path: ["snapshots", conflictingIndex, "targetPath"],
    message: "Recovery target paths must be unique without case or ancestor conflicts.",
  };
};

const checkUniqueSnapshotOrigins = (stored: RecoveryObjectFields): ZodIssueDetail | null => {
  const snapshotKeys = stored.snapshots.flatMap((snapshot) => {
    const original = snapshot.original;
    const hasOriginalFile = original._tag === "file";
    return hasOriginalFile ? [readRecoveryPathKey(original.snapshotPath)] : [];
  });

  const isEveryOriginUnique = new Set(snapshotKeys).size === snapshotKeys.length;
  if (isEveryOriginUnique) {
    return null;
  }

  return { path: ["snapshots"], message: "Recovery file snapshots must use unique source paths." };
};

const checkReceiptTargetCaptured = (stored: RecoveryObjectFields): ZodIssueDetail | null => {
  const isReceiptCaptured = stored.snapshots.some(
    (snapshot) => readNormalizedRecoveryPath(snapshot.targetPath) === readNormalizedRecoveryPath(stored.receiptPath),
  );
  if (isReceiptCaptured) {
    return null;
  }

  return { path: ["snapshots"], message: "Recovery snapshots must include the ownership receipt target." };
};

// The first broken rule wins, in the order the checks are listed.
const findRecoveryIssue = (stored: RecoveryObjectFields): ZodIssueDetail | null =>
  checkReceiptPath(stored) ??
  checkTransactionRoot(stored) ??
  checkTargetPaths(stored) ??
  checkSnapshotPaths(stored) ??
  checkUniqueTargets(stored) ??
  checkUniqueSnapshotOrigins(stored) ??
  checkReceiptTargetCaptured(stored);

const recoveryObjectSchema = recoveryObjectFieldsSchema.superRefine((stored, scope) => {
  addZodIssueDetails(scope, [findRecoveryIssue(stored)]);
});

export type StoredRecovery = z.infer<typeof recoveryObjectSchema>;

export const encodeRecoveryDocument = (stored: StoredRecovery): string =>
  JSON.stringify(recoveryObjectSchema.parse(stored));

export const decodeRecoveryDocument = (document: string): StoredRecovery => {
  const objectCheck = recoveryObjectSchema.safeParse(JSON.parse(document));

  const isObjectInvalid = !objectCheck.success;
  if (isObjectInvalid) {
    throw new Error(joinZodIssueMessages(objectCheck.error), { cause: objectCheck.error });
  }

  return objectCheck.data;
};
