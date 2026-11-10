import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { copyFile, link, mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { bytesEqual, hashBytes, isNotFound } from "./file-bytes.js";
import { type FileSnapshot, readFileSnapshot } from "./host-files.js";
import { readErrorMessage } from "./install-request.js";
import type { ExpectedCurrent, FileChange, Plan, Precondition, ReceiptOperation } from "./plan.js";
import { encodeReceiptJson } from "./receipt.js";
import {
  createUnfinishedChangeError,
  decodeRecoveryRecordJson,
  encodeRecoveryRecordJson,
  type RecoveryRecord,
  type TargetSnapshot,
} from "./recovery.js";
import { parentDirectories, validatePlanRoot, validateTarget } from "./target-paths.js";

interface PreparedFile {
  readonly operation: FileChange;
  readonly targetPath: string;
  readonly preparedPath: string;
  readonly snapshotPath: string;
}

interface PreparedPrecondition {
  readonly precondition: Precondition;
  readonly targetPath: string;
  readonly snapshotPath: string;
}

interface PreparedReceipt {
  readonly operation: ReceiptOperation;
  readonly targetPath: string;
  readonly recoveryPath: string;
  readonly preparedPath: string;
  readonly snapshotPath: string;
}

interface PreparedPlan {
  // The real path of the plan root, resolved once; every target must stay inside it.
  readonly root: string;
  readonly transactionRoot: string;
  readonly preparedDirectory: string;
  readonly snapshotsDirectory: string;
  readonly pendingRecordPath: string;
  readonly files: ReadonlyArray<PreparedFile>;
  readonly preconditions: ReadonlyArray<PreparedPrecondition>;
  readonly receipt: PreparedReceipt;
}

// What this transaction knows a target holds: its captured original, or bytes this transaction wrote.
type KnownTarget = TargetSnapshot["original"] | { readonly _tag: "bytes"; readonly bytes: Uint8Array };

interface Mutation {
  readonly snapshot: TargetSnapshot;
  readonly current: KnownTarget;
}

interface Transaction {
  readonly preparedPlan: PreparedPlan;
  readonly snapshots: ReadonlyArray<TargetSnapshot>;
  mutations: ReadonlyArray<Mutation>;
  createdDirectories: ReadonlyArray<string>;
  readonly signal: AbortSignal;
}

interface PreparedCommit {
  readonly path: string;
  readonly readBytes: () => Promise<Uint8Array>;
}

interface CaptureTarget {
  readonly targetPath: string;
  readonly snapshotPath: string;
}

interface PlannedTarget {
  readonly targetPath: string;
  readonly expected: ExpectedCurrent;
}

interface UnchangedCheck {
  readonly targetPath: string;
  readonly expected: KnownTarget;
  // Completes the failure message: "changed after <since>".
  readonly since: "it was captured" | "this transaction mutated it";
}

type RecoveryMarkerPublication = "published" | "alreadyHeld";

const isAlreadyExists = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "EEXIST";

// Returns null when nothing is at the path, so a missing file is not an error.
const statIfPresent = async (filePath: string): Promise<Stats | null> => {
  try {
    return await stat(filePath);
  } catch (error) {
    const isMissing = isNotFound(error);
    if (isMissing) {
      return null;
    }

    throw error;
  }
};

const isPathPresent = async (filePath: string): Promise<boolean> => {
  const fileStats = await statIfPresent(filePath);

  return fileStats != null;
};

// The first failure stays the visible message, so the user still sees the first problem.
const combineFailures = (failures: ReadonlyArray<unknown>): unknown => {
  const [firstFailure] = failures;
  const isSingleFailure = failures.length === 1;
  if (isSingleFailure) {
    return firstFailure;
  }

  return new AggregateError(failures, readErrorMessage(firstFailure));
};

// Runs every step, even after one fails, and returns the failures in order.
const collectFailures = async (steps: ReadonlyArray<() => Promise<unknown>>): Promise<Array<unknown>> => {
  const failures: Array<unknown> = [];
  for (const step of steps) {
    try {
      await step();
    } catch (failure) {
      failures.push(failure);
    }
  }

  return failures;
};

// Runs the cleanup, then returns the error to throw: the original failure plus any cleanup failure.
const createFailureAfterCleanUp = async (failure: unknown, cleanup: () => Promise<unknown>): Promise<unknown> => {
  const cleanupFailures = await collectFailures([cleanup]);

  return combineFailures([failure, ...cleanupFailures]);
};

const createTargetSnapshot = (targetPath: string, original: TargetSnapshot["original"]): TargetSnapshot => ({
  targetPath,
  original,
});

const createPendingRecoveryRecord = (transaction: Transaction): RecoveryRecord => ({
  _tag: "pending",
  version: 1,
  root: transaction.preparedPlan.root,
  receiptPath: transaction.preparedPlan.receipt.targetPath,
  transactionRoot: transaction.preparedPlan.transactionRoot,
  snapshots: transaction.snapshots,
});

const preparePlan = (plan: Plan, root: string): PreparedPlan => {
  const transactionRoot = join(root, `.agent-setup-transaction-${randomUUID()}`);
  const preparedDirectory = join(transactionRoot, "prepared");
  const snapshotsDirectory = join(transactionRoot, "snapshots");
  const receiptTargetPath = resolve(root, plan.receipt.target.path);

  return {
    root,
    transactionRoot,
    preparedDirectory,
    snapshotsDirectory,
    pendingRecordPath: join(transactionRoot, "pending.json"),
    files: plan.operations.map((operation, index) => ({
      operation,
      targetPath: resolve(root, operation.file.path),
      preparedPath: join(preparedDirectory, String(index)),
      snapshotPath: join(snapshotsDirectory, String(index)),
    })),
    preconditions: plan.preconditions.map((precondition, index) => ({
      precondition,
      targetPath: resolve(root, precondition.path),
      snapshotPath: join(snapshotsDirectory, `precondition-${index}`),
    })),
    receipt: {
      operation: plan.receipt,
      targetPath: receiptTargetPath,
      recoveryPath: join(dirname(receiptTargetPath), "recovery.json"),
      preparedPath: join(preparedDirectory, "receipt"),
      snapshotPath: join(snapshotsDirectory, "receipt"),
    },
  };
};

const preflightTargets = async (preparedPlan: PreparedPlan): Promise<void> => {
  const targetPaths = [
    ...preparedPlan.files.map((file) => file.targetPath),
    ...preparedPlan.preconditions.map((precondition) => precondition.targetPath),
    preparedPlan.receipt.targetPath,
    preparedPlan.receipt.recoveryPath,
  ];
  for (const targetPath of targetPaths) {
    await validateTarget(preparedPlan.root, targetPath);
  }
};

const ensureRecoveryAbsent = async (recoveryPath: string): Promise<void> => {
  const isRecoveryPresent = await isPathPresent(recoveryPath);
  if (isRecoveryPresent) {
    throw createUnfinishedChangeError(recoveryPath);
  }
};

const removeTransaction = (preparedPlan: PreparedPlan): Promise<void> =>
  rm(preparedPlan.transactionRoot, { recursive: true, force: true });

const captureTarget = async (root: string, target: CaptureTarget): Promise<TargetSnapshot> => {
  await validateTarget(root, target.targetPath);
  const currentSnapshot = await readFileSnapshot(target.targetPath);
  const isMissing = currentSnapshot._tag === "missing";
  if (isMissing) {
    return createTargetSnapshot(target.targetPath, { _tag: "missing" });
  }

  await writeFile(target.snapshotPath, currentSnapshot.bytes, { mode: 0o600 });

  return createTargetSnapshot(target.targetPath, { _tag: "file", snapshotPath: target.snapshotPath });
};

// The transaction directory is removed again if any capture step fails.
const captureTargets = async (preparedPlan: PreparedPlan): Promise<Array<TargetSnapshot>> => {
  await mkdir(preparedPlan.transactionRoot, { mode: 0o700 });
  try {
    await mkdir(preparedPlan.preparedDirectory, { mode: 0o700 });
    await mkdir(preparedPlan.snapshotsDirectory, { mode: 0o700 });

    const snapshots: Array<TargetSnapshot> = [];
    for (const target of [...preparedPlan.files, ...preparedPlan.preconditions, preparedPlan.receipt]) {
      const snapshot = await captureTarget(preparedPlan.root, target);
      snapshots.push(snapshot);
    }

    return snapshots;
  } catch (captureFailure) {
    const failureAfterCleanUp = await createFailureAfterCleanUp(captureFailure, () => removeTransaction(preparedPlan));
    throw failureAfterCleanUp;
  }
};

const findSnapshot = (transaction: Transaction, targetPath: string): TargetSnapshot => {
  const snapshot = transaction.snapshots.find((candidate) => candidate.targetPath === targetPath);
  const isSnapshotMissing = snapshot == null;
  if (isSnapshotMissing) {
    throw new Error(`Transaction snapshot missing for ${targetPath}`);
  }

  return snapshot;
};

const ensureMatchesPlannedState = async (transaction: Transaction, target: PlannedTarget): Promise<void> => {
  const snapshot = findSnapshot(transaction, target.targetPath);
  const { original } = snapshot;
  const { expected } = target;
  const isMissingAsPlanned = expected._tag === "missing" && original._tag === "missing";
  if (isMissingAsPlanned) {
    return;
  }

  const isFileAsPlanned = expected._tag === "file" && original._tag === "file";
  if (isFileAsPlanned) {
    const capturedBytes = await readFile(original.snapshotPath);
    const isSameHash = hashBytes(capturedBytes) === expected.sha256;
    if (isSameHash) {
      return;
    }
  }

  throw new Error(
    `FileSystem.stat: Transaction target ${target.targetPath} no longer matches the state inspected during planning.`,
  );
};

const validatePlanPreconditions = async (transaction: Transaction): Promise<void> => {
  const { files, preconditions, receipt } = transaction.preparedPlan;
  const plannedTargets: Array<PlannedTarget> = [
    ...files.map((file) => ({ targetPath: file.targetPath, expected: file.operation.expectedCurrent })),
    ...preconditions.map((preparedPrecondition) => ({
      targetPath: preparedPrecondition.targetPath,
      expected: preparedPrecondition.precondition.expectedCurrent,
    })),
    { targetPath: receipt.targetPath, expected: receipt.operation.expectedCurrent },
  ];
  for (const plannedTarget of plannedTargets) {
    await ensureMatchesPlannedState(transaction, plannedTarget);
  }
};

const prepareFile = async (file: PreparedFile): Promise<void> => {
  const { operation, preparedPath } = file;
  const isRemoval = operation._tag === "remove";
  if (isRemoval) {
    return;
  }

  await writeFile(preparedPath, operation.bytes);
};

const prepareTargets = async (preparedPlan: PreparedPlan): Promise<void> => {
  for (const file of preparedPlan.files) {
    await prepareFile(file);
  }

  const { operation, preparedPath } = preparedPlan.receipt;
  const isReceiptPublish = operation._tag === "receiptPublish";
  if (isReceiptPublish) {
    const encodedReceipt = encodeReceiptJson(operation.receipt);
    await writeFile(preparedPath, encodedReceipt);
  }
};

const ensureTargetParent = async (transaction: Transaction, targetPath: string): Promise<void> => {
  for (const directory of parentDirectories(transaction.preparedPlan.root, targetPath)) {
    const directoryStats = await statIfPresent(directory);
    const isDirectory = directoryStats?.isDirectory() === true;
    if (isDirectory) {
      continue;
    }

    await mkdir(directory);
    transaction.createdDirectories = [...transaction.createdDirectories, directory];
  }
};

// The marker is hard-linked into place so only one concurrent transaction can publish it.
// Returns "alreadyHeld" when another transaction already holds it.
const publishRecoveryMarker = async (transaction: Transaction): Promise<RecoveryMarkerPublication> => {
  const { pendingRecordPath, receipt, root } = transaction.preparedPlan;
  const encodedRecoveryRecord = encodeRecoveryRecordJson(createPendingRecoveryRecord(transaction));

  await writeFile(pendingRecordPath, encodedRecoveryRecord, { flag: "wx", mode: 0o600 });
  await ensureTargetParent(transaction, receipt.recoveryPath);
  await validateTarget(root, receipt.recoveryPath);
  try {
    await link(pendingRecordPath, receipt.recoveryPath);
    return "published";
  } catch (linkFailure) {
    const isHeldByAnother = isAlreadyExists(linkFailure);
    if (isHeldByAnother) {
      return "alreadyHeld";
    }

    throw linkFailure;
  }
};

// Returns true when this transaction published the marker. A failed attempt cleans up by what is on disk.
const claimRecoveryMarker = async (transaction: Transaction): Promise<boolean> => {
  try {
    const publication = await publishRecoveryMarker(transaction);

    return publication === "published";
  } catch (markerFailure) {
    const failureAfterAttempt = await createFailureAfterMarkerAttempt(transaction, markerFailure);
    throw failureAfterAttempt;
  }
};

const verifyRecoveryMarker = async (transaction: Transaction): Promise<void> => {
  const { recoveryPath } = transaction.preparedPlan.receipt;
  const encodedMarker = await readFile(recoveryPath, "utf8");
  const recordOnDisk = decodeRecoveryRecordJson(encodedMarker);
  const isRecordChanged =
    encodeRecoveryRecordJson(recordOnDisk) !== encodeRecoveryRecordJson(createPendingRecoveryRecord(transaction));
  if (isRecordChanged) {
    throw new Error(`FileSystem.readFile: Recovery marker ${recoveryPath} changed during the transaction.`);
  }
};

const isHoldingKnownTarget = async (current: FileSnapshot, known: KnownTarget): Promise<boolean> => {
  const isCurrentMissing = current._tag === "missing";
  if (isCurrentMissing) {
    return known._tag === "missing";
  }

  const isKnownMissing = known._tag === "missing";
  if (isKnownMissing) {
    return false;
  }

  const isKnownInMemory = known._tag === "bytes";
  if (isKnownInMemory) {
    return bytesEqual(current.bytes, known.bytes);
  }

  const capturedBytes = await readFile(known.snapshotPath);

  return bytesEqual(current.bytes, capturedBytes);
};

// Fails unless the target still holds the known state, so no step overwrites bytes someone else changed.
const ensureUnchanged = async (transaction: Transaction, check: UnchangedCheck): Promise<void> => {
  await validateTarget(transaction.preparedPlan.root, check.targetPath);
  const currentSnapshot = await readFileSnapshot(check.targetPath);
  const isStillKnown = await isHoldingKnownTarget(currentSnapshot, check.expected);
  if (isStillKnown) {
    return;
  }

  throw new Error(`FileSystem.stat: Transaction target ${check.targetPath} changed after ${check.since}.`);
};

const setKnownTarget = (transaction: Transaction, targetPath: string, knownTarget: KnownTarget): void => {
  transaction.mutations = transaction.mutations.map((mutation) => {
    const isOtherTarget = mutation.snapshot.targetPath !== targetPath;
    if (isOtherTarget) {
      return mutation;
    }

    return { ...mutation, current: knownTarget };
  });
};

const findCheckedSnapshot = async (transaction: Transaction, targetPath: string): Promise<TargetSnapshot> => {
  const snapshot = findSnapshot(transaction, targetPath);
  await ensureUnchanged(transaction, { targetPath, expected: snapshot.original, since: "it was captured" });

  return snapshot;
};

// Records the captured original before the target is removed, so rollback can restore it.
const recordAndRemove = async (transaction: Transaction, snapshot: TargetSnapshot): Promise<void> => {
  transaction.mutations = [...transaction.mutations, { snapshot, current: snapshot.original }];
  await rm(snapshot.targetPath, { force: true });
  setKnownTarget(transaction, snapshot.targetPath, { _tag: "missing" });
};

// Every step is recorded before the next one, so rollback knows exactly what this transaction left on disk.
const replaceTarget = async (transaction: Transaction, targetPath: string, prepared: PreparedCommit): Promise<void> => {
  await ensureTargetParent(transaction, targetPath);
  const snapshot = await findCheckedSnapshot(transaction, targetPath);
  const preparedBytes = await prepared.readBytes();
  await recordAndRemove(transaction, snapshot);
  await rename(prepared.path, targetPath);
  setKnownTarget(transaction, targetPath, { _tag: "bytes", bytes: preparedBytes });
  transaction.signal.throwIfAborted();
};

const removeTarget = async (transaction: Transaction, targetPath: string): Promise<void> => {
  const snapshot = await findCheckedSnapshot(transaction, targetPath);
  await recordAndRemove(transaction, snapshot);
  transaction.signal.throwIfAborted();
};

const commitFiles = async (transaction: Transaction): Promise<void> => {
  for (const { operation, targetPath, preparedPath } of transaction.preparedPlan.files) {
    const isRemoval = operation._tag === "remove";
    if (isRemoval) {
      await removeTarget(transaction, targetPath);
    } else {
      await replaceTarget(transaction, targetPath, { path: preparedPath, readBytes: async () => operation.bytes });
    }
  }
};

const commitReceipt = async (transaction: Transaction): Promise<void> => {
  const { operation, targetPath, preparedPath } = transaction.preparedPlan.receipt;
  const isReceiptPublish = operation._tag === "receiptPublish";
  if (isReceiptPublish) {
    await replaceTarget(transaction, targetPath, { path: preparedPath, readBytes: () => readFile(preparedPath) });
    return;
  }

  await removeTarget(transaction, targetPath);
};

const restoreTarget = async (transaction: Transaction, mutation: Mutation): Promise<void> => {
  const { targetPath, original } = mutation.snapshot;
  await ensureUnchanged(transaction, {
    targetPath,
    expected: mutation.current,
    since: "this transaction mutated it",
  });
  await rm(targetPath, { force: true });
  const isFileOriginal = original._tag === "file";
  if (isFileOriginal) {
    await copyFile(original.snapshotPath, targetPath);
  }
};

// Undoes recorded mutations newest first and returns the failures of any that could not be undone.
const restoreTargets = (transaction: Transaction): Promise<Array<unknown>> => {
  const newestFirst = [...transaction.mutations].reverse();

  return collectFailures(newestFirst.map((mutation) => () => restoreTarget(transaction, mutation)));
};

// Node's rmdir refuses a folder that still holds anything, so a failure here means the folder stays.
const removeEmptyDirectory = async (directory: string): Promise<void> => {
  try {
    await rmdir(directory);
  } catch (cause) {
    throw new Error("Could not remove an empty directory.", { cause });
  }
};

const removeCreatedDirectories = async (transaction: Transaction): Promise<void> => {
  const deepestFirst = [...new Set(transaction.createdDirectories)].sort((left, right) => right.length - left.length);
  for (const directory of deepestFirst) {
    await removeEmptyDirectory(directory);
  }
};

// Folders that held only removed files are left empty, so remove them too. One that still holds
// anything, or cannot be removed, stays and does not fail the finished transaction.
const removeEmptiedDirectories = async (preparedPlan: PreparedPlan): Promise<void> => {
  const removedPaths = [...preparedPlan.files, preparedPlan.receipt]
    .filter((target) => target.operation._tag === "remove")
    .map((target) => target.targetPath);
  const parentLists = removedPaths.map((targetPath) => parentDirectories(preparedPlan.root, targetPath));
  const deepestFirst = [...new Set(parentLists.flat())].sort((left, right) => right.length - left.length);

  await collectFailures(deepestFirst.map((directory) => () => removeEmptyDirectory(directory)));
};

// Unlinks the marker only after proving it is still the one this transaction published.
const releaseMarker = async (transaction: Transaction): Promise<void> => {
  await verifyRecoveryMarker(transaction);
  await rm(transaction.preparedPlan.receipt.recoveryPath);
  await removeTransaction(transaction.preparedPlan);
};

const cleanupWithoutMarker = async (transaction: Transaction): Promise<void> => {
  await removeTransaction(transaction.preparedPlan);
  await removeCreatedDirectories(transaction);
};

const cleanupWithMarker = async (transaction: Transaction): Promise<void> => {
  await releaseMarker(transaction);
  await removeCreatedDirectories(transaction);
};

// A failed or defective link may still have published the marker, so clean up by what is on disk.
const cleanupAfterMarkerAttempt = async (transaction: Transaction): Promise<void> => {
  const isMarkerOnDisk = await isPathPresent(transaction.preparedPlan.receipt.recoveryPath);
  if (isMarkerOnDisk) {
    await cleanupWithMarker(transaction);
    return;
  }

  await cleanupWithoutMarker(transaction);
};

const createFailureAfterMarkerAttempt = async (transaction: Transaction, markerFailure: unknown): Promise<unknown> => {
  const cleanupFailures = await collectFailures([() => cleanupAfterMarkerAttempt(transaction)]);
  const isCleanupClean = cleanupFailures.length === 0;
  if (isCleanupClean) {
    return markerFailure;
  }

  return combineFailures([
    markerFailure,
    ...cleanupFailures,
    createUnfinishedChangeError(transaction.preparedPlan.transactionRoot),
  ]);
};

// Keeps the marker and snapshots as recovery evidence: verifies the marker, then drops the prepared copies.
const keepRecoveryEvidence = async (transaction: Transaction): Promise<void> => {
  await verifyRecoveryMarker(transaction);
  await rm(transaction.preparedPlan.preparedDirectory, { recursive: true, force: true });
};

// After a commit failure every recorded target is restored. If any restore fails, the marker and
// snapshots stay on disk as recovery evidence and the pending recovery location is reported.
const createFailureAfterCommit = async (transaction: Transaction, commitFailure: unknown): Promise<unknown> => {
  const rollbackFailures = await restoreTargets(transaction);
  const isRollbackClean = rollbackFailures.length === 0;
  if (isRollbackClean) {
    const cleanupFailures = await collectFailures([() => cleanupWithMarker(transaction)]);

    return combineFailures([commitFailure, ...cleanupFailures]);
  }

  const retainFailures = await collectFailures([() => keepRecoveryEvidence(transaction)]);

  return combineFailures([
    commitFailure,
    combineFailures(rollbackFailures),
    createUnfinishedChangeError(transaction.preparedPlan.receipt.recoveryPath),
    ...retainFailures,
  ]);
};

// Applies one checked plan as a transaction: capture every target, prepare, commit files, then the receipt.
// A receipt is deletion authority, so it is committed only after every file change has succeeded.
export const applyPlan = async (plan: Plan, signal: AbortSignal): Promise<void> => {
  const root = await validatePlanRoot(plan.root);
  const preparedPlan = preparePlan(plan, root);
  await preflightTargets(preparedPlan);
  await ensureRecoveryAbsent(preparedPlan.receipt.recoveryPath);
  const snapshots = await captureTargets(preparedPlan);
  const transaction: Transaction = { preparedPlan, snapshots, mutations: [], createdDirectories: [], signal };

  // Stale planning evidence or a preparation failure leaves every destination untouched.
  try {
    await validatePlanPreconditions(transaction);
    await prepareTargets(preparedPlan);
  } catch (preparationFailure) {
    const failureAfterCleanUp = await createFailureAfterCleanUp(preparationFailure, () =>
      removeTransaction(preparedPlan),
    );
    throw failureAfterCleanUp;
  }

  const isMarkerPublished = await claimRecoveryMarker(transaction);
  const isMarkerHeldByAnother = !isMarkerPublished;
  if (isMarkerHeldByAnother) {
    const unfinishedChangeError = createUnfinishedChangeError(preparedPlan.receipt.recoveryPath);
    const failureAfterCleanUp = await createFailureAfterCleanUp(unfinishedChangeError, () =>
      cleanupWithoutMarker(transaction),
    );
    throw failureAfterCleanUp;
  }

  try {
    transaction.signal.throwIfAborted();
    await commitFiles(transaction);
    await commitReceipt(transaction);
  } catch (commitFailure) {
    const failureAfterRecovery = await createFailureAfterCommit(transaction, commitFailure);
    throw failureAfterRecovery;
  }

  await releaseMarker(transaction);
  await removeEmptiedDirectories(preparedPlan);
};
