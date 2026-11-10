import { z } from "zod";

import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "#src/zod-issue-messages.js";
import { nonEmptyTrimmedTextSchema } from "./text-rules.js";

const portablePath = (filePath: string): string => filePath.replaceAll("\\", "/");

const normalizedRecoveryPath = (filePath: string): string => {
  const normalized = portablePath(filePath);

  return normalized.endsWith("/") && normalized !== "/" && !/^[A-Za-z]:\/$/.test(normalized)
    ? normalized.slice(0, -1)
    : normalized;
};

const childPathPrefix = (root: string): string => (root.endsWith("/") ? root : `${root}/`);

const transactionDirectoryNamePattern =
  /^\.agent-setup-transaction-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isCanonicalAbsolutePath = (filePath: string): boolean => {
  const driveQualified = /^[A-Za-z]:[\\/]/.test(filePath);
  if (filePath.includes("\0") || (!driveQualified && (!filePath.startsWith("/") || filePath.includes("\\")))) {
    return false;
  }

  const remainder = driveQualified ? portablePath(filePath).slice(3) : filePath.slice(1);
  return remainder === "" || remainder.split("/").every((part) => part !== "" && part !== "." && part !== "..");
};

export const isInsideFolder = (root: string, candidate: string): boolean => {
  const normalizedRoot = normalizedRecoveryPath(root);
  const normalizedCandidate = normalizedRecoveryPath(candidate);

  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(childPathPrefix(normalizedRoot));
};

const recoveryPathKey = (filePath: string): string => normalizedRecoveryPath(filePath).toLowerCase();

const recoveryPathsConflict = (left: string, right: string): boolean => {
  const leftKey = recoveryPathKey(left);
  const rightKey = recoveryPathKey(right);

  return (
    leftKey === rightKey ||
    leftKey.startsWith(childPathPrefix(rightKey)) ||
    rightKey.startsWith(childPathPrefix(leftKey))
  );
};

const recoveryMarkerPath = (receiptPath: string): string => {
  const normalizedReceiptPath = normalizedRecoveryPath(receiptPath);

  return `${normalizedReceiptPath.slice(0, normalizedReceiptPath.lastIndexOf("/"))}/recovery.json`;
};

const isDirectSnapshotPath = (transactionRoot: string, snapshotPath: string): boolean => {
  const snapshotsPrefix = `${childPathPrefix(normalizedRecoveryPath(transactionRoot))}snapshots/`;
  const normalizedSnapshotPath = normalizedRecoveryPath(snapshotPath);
  const snapshotName = normalizedSnapshotPath.startsWith(snapshotsPrefix)
    ? normalizedSnapshotPath.slice(snapshotsPrefix.length)
    : "";

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

const recoveryRecordFieldsSchema = z.strictObject({
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

type RecoveryRecordFields = z.infer<typeof recoveryRecordFieldsSchema>;

const checkReceiptPath = (record: RecoveryRecordFields): ZodIssueDetail | null => {
  const isReceiptPathValid =
    isInsideFolder(record.root, record.receiptPath) && portablePath(record.receiptPath).endsWith("/receipt.json");
  if (isReceiptPathValid) {
    return null;
  }

  return {
    path: ["receiptPath"],
    message: "Recovery receipt paths must stay under the decoded root and end in receipt.json.",
  };
};

const checkTransactionRoot = (record: RecoveryRecordFields): ZodIssueDetail | null => {
  const transactionName = normalizedRecoveryPath(record.transactionRoot).slice(
    childPathPrefix(normalizedRecoveryPath(record.root)).length,
  );
  const isTransactionRootValid =
    isInsideFolder(record.root, record.transactionRoot) && transactionDirectoryNamePattern.test(transactionName);
  if (isTransactionRootValid) {
    return null;
  }

  return {
    path: ["transactionRoot"],
    message: "Recovery transaction roots must be direct reserved children of the decoded root.",
  };
};

const checkTargetPaths = (record: RecoveryRecordFields): ZodIssueDetail | null => {
  const markerPath = recoveryMarkerPath(record.receiptPath);
  const invalidIndex = record.snapshots.findIndex(
    (snapshot) =>
      !isInsideFolder(record.root, snapshot.targetPath) ||
      normalizedRecoveryPath(snapshot.targetPath) === normalizedRecoveryPath(record.root) ||
      recoveryPathsConflict(snapshot.targetPath, markerPath) ||
      recoveryPathsConflict(record.transactionRoot, snapshot.targetPath),
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

const checkSnapshotPaths = (record: RecoveryRecordFields): ZodIssueDetail | null => {
  const invalidIndex = record.snapshots.findIndex(
    (snapshot) =>
      snapshot.original._tag === "file" &&
      !isDirectSnapshotPath(record.transactionRoot, snapshot.original.snapshotPath),
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

const checkUniqueTargets = (record: RecoveryRecordFields): ZodIssueDetail | null => {
  const targetPaths = record.snapshots.map((snapshot) => snapshot.targetPath);
  const conflictingIndex = targetPaths.findIndex((candidate, index) =>
    targetPaths.slice(0, index).some((prior) => recoveryPathsConflict(prior, candidate)),
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

const checkUniqueSnapshotSources = (record: RecoveryRecordFields): ZodIssueDetail | null => {
  const snapshotKeys = record.snapshots.flatMap((snapshot) =>
    snapshot.original._tag === "file" ? [recoveryPathKey(snapshot.original.snapshotPath)] : [],
  );
  const isEverySourceUnique = new Set(snapshotKeys).size === snapshotKeys.length;
  if (isEverySourceUnique) {
    return null;
  }

  return { path: ["snapshots"], message: "Recovery file snapshots must use unique source paths." };
};

const checkReceiptTargetCaptured = (record: RecoveryRecordFields): ZodIssueDetail | null => {
  const isReceiptCaptured = record.snapshots.some(
    (snapshot) => normalizedRecoveryPath(snapshot.targetPath) === normalizedRecoveryPath(record.receiptPath),
  );
  if (isReceiptCaptured) {
    return null;
  }

  return { path: ["snapshots"], message: "Recovery snapshots must include the ownership receipt target." };
};

// The first broken rule wins, in the order the checks are listed.
const findRecoveryRecordIssue = (record: RecoveryRecordFields): ZodIssueDetail | null =>
  checkReceiptPath(record) ??
  checkTransactionRoot(record) ??
  checkTargetPaths(record) ??
  checkSnapshotPaths(record) ??
  checkUniqueTargets(record) ??
  checkUniqueSnapshotSources(record) ??
  checkReceiptTargetCaptured(record);

export const recoveryRecordSchema = recoveryRecordFieldsSchema.superRefine((record, context) => {
  addZodIssueDetails(context, [findRecoveryRecordIssue(record)]);
});

export type RecoveryRecord = z.infer<typeof recoveryRecordSchema>;

export const encodeRecoveryRecordJson = (record: RecoveryRecord): string =>
  JSON.stringify(recoveryRecordSchema.parse(record));

export const decodeRecoveryRecordJson = (json: string): RecoveryRecord => {
  const recordCheck = recoveryRecordSchema.safeParse(JSON.parse(json));
  const isRecordInvalid = !recordCheck.success;
  if (isRecordInvalid) {
    throw new Error(joinZodIssueMessages(recordCheck.error), { cause: recordCheck.error });
  }

  return recordCheck.data;
};
