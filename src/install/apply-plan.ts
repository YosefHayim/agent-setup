import { randomUUID } from "node:crypto";
import { rmdir } from "node:fs/promises";

import { FileSystem, Path } from "@effect/platform";
import { BadArgument, type PlatformError, SystemError } from "@effect/platform/Error";
import { Cause, Effect, Exit, Ref } from "effect";

import { bytesEqual, hashBytes, isNotFound } from "./file-bytes.js";
import { type FileSnapshot, readFileSnapshot } from "./host-files.js";
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

type PreparedFile = {
  readonly operation: FileChange;
  readonly targetPath: string;
  readonly preparedPath: string;
  readonly snapshotPath: string;
};

type PreparedPrecondition = {
  readonly precondition: Precondition;
  readonly targetPath: string;
  readonly snapshotPath: string;
};

type PreparedReceipt = {
  readonly operation: ReceiptOperation;
  readonly targetPath: string;
  readonly recoveryPath: string;
  readonly preparedPath: string;
  readonly snapshotPath: string;
};

type PreparedPlan = {
  // The real path of the plan root, resolved once; every target must stay inside it.
  readonly root: string;
  readonly transactionRoot: string;
  readonly preparedDirectory: string;
  readonly snapshotsDirectory: string;
  readonly pendingRecordPath: string;
  readonly files: ReadonlyArray<PreparedFile>;
  readonly preconditions: ReadonlyArray<PreparedPrecondition>;
  readonly receipt: PreparedReceipt;
};

// What a target holds as far as this transaction knows: its captured original, or bytes this transaction committed.
type TargetState = TargetSnapshot["original"] | { readonly _tag: "bytes"; readonly value: Uint8Array };

type Mutation = {
  readonly snapshot: TargetSnapshot;
  readonly current: TargetState;
};

type Transaction = {
  readonly preparedPlan: PreparedPlan;
  readonly snapshots: ReadonlyArray<TargetSnapshot>;
  readonly mutations: Ref.Ref<ReadonlyArray<Mutation>>;
  readonly createdDirectories: Ref.Ref<ReadonlyArray<string>>;
};

type CommitStep = {
  readonly targetPath: string;
  // Absent when the target is removed rather than replaced.
  readonly prepared?: {
    readonly path: string;
    readonly bytes: Effect.Effect<Uint8Array, PlatformError, FileSystem.FileSystem>;
  };
};

const badArgument = (method: string, description: string) =>
  new BadArgument({ module: "FileSystem", method, description });

const isAlreadyExists = (error: PlatformError): boolean =>
  error._tag === "SystemError" && error.reason === "AlreadyExists";

const checkTarget = (root: string, targetPath: string) =>
  Effect.tryPromise({ try: () => validateTarget(root, targetPath), catch: (cause) => cause });

const checkPlanRoot = (planRoot: string) =>
  Effect.tryPromise({ try: () => validatePlanRoot(planRoot), catch: (cause) => cause });

const combineCauses = (causes: ReadonlyArray<Cause.Cause<unknown>>): Cause.Cause<unknown> =>
  causes.reduce((combined, cause) => Cause.sequential(combined, cause), Cause.empty);

const failureCauses = (exits: ReadonlyArray<Exit.Exit<unknown, unknown>>) =>
  exits.flatMap((exit) => (Exit.isFailure(exit) ? [exit.cause] : []));

const unfinishedChange = (recoveryPath: string) => Cause.fail(createUnfinishedChangeError(recoveryPath));

// Runs the cleanup, then fails with the original cause plus any cleanup failure.
const failAfter = <R>(cause: Cause.Cause<unknown>, cleanup: Effect.Effect<unknown, unknown, R>) =>
  Effect.flatMap(Effect.exit(cleanup), (cleanupExit) =>
    Effect.failCause(Exit.isFailure(cleanupExit) ? Cause.sequential(cause, cleanupExit.cause) : cause),
  );

const pathExists = (filePath: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
    fileSystem.stat(filePath).pipe(
      Effect.as(true),
      Effect.catchIf(isNotFound, () => Effect.succeed(false)),
    ),
  );

const targetSnapshot = (targetPath: string, original: TargetSnapshot["original"]): TargetSnapshot => ({
  targetPath,
  original,
});

const preparePlan = (plan: Plan, root: string) =>
  Effect.map(Path.Path, (path): PreparedPlan => {
    const transactionRoot = path.join(root, `.agent-setup-transaction-${randomUUID()}`);
    const preparedDirectory = path.join(transactionRoot, "prepared");
    const snapshotsDirectory = path.join(transactionRoot, "snapshots");
    const receiptTargetPath = path.resolve(root, plan.receipt.target.path);

    return {
      root,
      transactionRoot,
      preparedDirectory,
      snapshotsDirectory,
      pendingRecordPath: path.join(transactionRoot, "pending.json"),
      files: plan.operations.map((operation, index) => ({
        operation,
        targetPath: path.resolve(root, operation.file.path),
        preparedPath: path.join(preparedDirectory, String(index)),
        snapshotPath: path.join(snapshotsDirectory, String(index)),
      })),
      preconditions: plan.preconditions.map((precondition, index) => ({
        precondition,
        targetPath: path.resolve(root, precondition.path),
        snapshotPath: path.join(snapshotsDirectory, `precondition-${index}`),
      })),
      receipt: {
        operation: plan.receipt,
        targetPath: receiptTargetPath,
        recoveryPath: path.join(path.dirname(receiptTargetPath), "recovery.json"),
        preparedPath: path.join(preparedDirectory, "receipt"),
        snapshotPath: path.join(snapshotsDirectory, "receipt"),
      },
    };
  });

const preflightTargets = (preparedPlan: PreparedPlan) =>
  Effect.forEach(
    [
      ...preparedPlan.files.map((file) => file.targetPath),
      ...preparedPlan.preconditions.map((precondition) => precondition.targetPath),
      preparedPlan.receipt.targetPath,
      preparedPlan.receipt.recoveryPath,
    ],
    (targetPath) => checkTarget(preparedPlan.root, targetPath),
    { discard: true },
  );

const ensureRecoveryAbsent = (recoveryPath: string) =>
  Effect.gen(function* () {
    if (yield* pathExists(recoveryPath)) {
      return yield* Effect.fail(createUnfinishedChangeError(recoveryPath));
    }
  });

const removeTransaction = (preparedPlan: PreparedPlan) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
    fileSystem.remove(preparedPlan.transactionRoot, { recursive: true, force: true }),
  );

const captureTarget = (root: string, target: { targetPath: string; snapshotPath: string }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* checkTarget(root, target.targetPath);
    const current = yield* readFileSnapshot(target.targetPath);
    if (current._tag === "missing") {
      return targetSnapshot(target.targetPath, { _tag: "missing" });
    }

    yield* fileSystem.writeFile(target.snapshotPath, current.bytes, { mode: 0o600 });
    return targetSnapshot(target.targetPath, { _tag: "file", snapshotPath: target.snapshotPath });
  });

// Capture may be interrupted, but the transaction directory it created is always removed.
const captureTargets = (preparedPlan: PreparedPlan) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.makeDirectory(preparedPlan.transactionRoot, { mode: 0o700 });
      const captureExit = yield* Effect.exit(
        Effect.interruptible(
          Effect.gen(function* () {
            yield* fileSystem.makeDirectory(preparedPlan.preparedDirectory, { mode: 0o700 });
            yield* fileSystem.makeDirectory(preparedPlan.snapshotsDirectory, { mode: 0o700 });
            return yield* Effect.forEach(
              [...preparedPlan.files, ...preparedPlan.preconditions, preparedPlan.receipt],
              (target) => captureTarget(preparedPlan.root, target),
            );
          }),
        ),
      );
      if (Exit.isSuccess(captureExit)) {
        return captureExit.value;
      }

      return yield* failAfter(captureExit.cause, removeTransaction(preparedPlan));
    }),
  );

const findSnapshot = (transaction: Transaction, targetPath: string) => {
  const snapshot = transaction.snapshots.find((candidate) => candidate.targetPath === targetPath);

  return snapshot === undefined
    ? Effect.dieMessage(`Transaction snapshot missing for ${targetPath}`)
    : Effect.succeed(snapshot);
};

const matchesPlannedState = (transaction: Transaction, target: { targetPath: string; expected: ExpectedCurrent }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const snapshot = yield* findSnapshot(transaction, target.targetPath);
    if (target.expected._tag === "missing" && snapshot.original._tag === "missing") {
      return;
    }

    if (target.expected._tag === "file" && snapshot.original._tag === "file") {
      const capturedBytes = yield* fileSystem.readFile(snapshot.original.snapshotPath);
      if (hashBytes(capturedBytes) === target.expected.sha256) {
        return;
      }
    }

    return yield* badArgument(
      "stat",
      `Transaction target ${target.targetPath} no longer matches the state inspected during planning.`,
    );
  });

const validatePlanPreconditions = (transaction: Transaction) => {
  const { files, preconditions, receipt } = transaction.preparedPlan;

  return Effect.forEach(
    [
      ...files.map((file) => ({ targetPath: file.targetPath, expected: file.operation.expectedCurrent })),
      ...preconditions.map((guard) => ({ targetPath: guard.targetPath, expected: guard.precondition.expectedCurrent })),
      { targetPath: receipt.targetPath, expected: receipt.operation.expectedCurrent },
    ],
    (target) => matchesPlannedState(transaction, target),
    { discard: true },
  );
};

const prepareFile = (file: PreparedFile) =>
  Effect.gen(function* () {
    if (file.operation._tag === "remove") {
      return;
    }

    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFile(file.preparedPath, file.operation.bytes);
  });

const prepareTargets = (preparedPlan: PreparedPlan) =>
  Effect.gen(function* () {
    yield* Effect.forEach(preparedPlan.files, prepareFile, { discard: true });
    if (preparedPlan.receipt.operation._tag === "receiptPublish") {
      const fileSystem = yield* FileSystem.FileSystem;
      const receiptJson = encodeReceiptJson(preparedPlan.receipt.operation.receipt);
      yield* fileSystem.writeFileString(preparedPlan.receipt.preparedPath, receiptJson);
    }
  });

const ensureTargetParent = (transaction: Transaction, targetPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    for (const directory of parentDirectories(transaction.preparedPlan.root, targetPath)) {
      const isDirectory = yield* fileSystem.stat(directory).pipe(
        Effect.map((entry) => entry.type === "Directory"),
        Effect.catchIf(isNotFound, () => Effect.succeed(false)),
      );
      if (!isDirectory) {
        yield* fileSystem.makeDirectory(directory);
        yield* Ref.update(transaction.createdDirectories, (directories) => [...directories, directory]);
      }
    }
  });

const pendingRecoveryRecord = (transaction: Transaction): RecoveryRecord => ({
  _tag: "pending",
  version: 1,
  root: transaction.preparedPlan.root,
  receiptPath: transaction.preparedPlan.receipt.targetPath,
  transactionRoot: transaction.preparedPlan.transactionRoot,
  snapshots: transaction.snapshots,
});

// The marker is hard-linked into place so only one concurrent transaction can publish it.
// Succeeds with false when another transaction already holds it.
const publishRecoveryMarker = (transaction: Transaction) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const { pendingRecordPath, receipt, root } = transaction.preparedPlan;
    const recoveryJson = encodeRecoveryRecordJson(pendingRecoveryRecord(transaction));

    yield* fileSystem.writeFileString(pendingRecordPath, recoveryJson, { flag: "wx", mode: 0o600 });
    yield* ensureTargetParent(transaction, receipt.recoveryPath);
    yield* checkTarget(root, receipt.recoveryPath);
    return yield* fileSystem.link(pendingRecordPath, receipt.recoveryPath).pipe(
      Effect.as(true),
      Effect.catchIf(isAlreadyExists, () => Effect.succeed(false)),
    );
  });

const verifyRecoveryMarker = (transaction: Transaction) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const recoveryPath = transaction.preparedPlan.receipt.recoveryPath;
    const recoveryJson = yield* fileSystem.readFileString(recoveryPath);
    const recoveryRecord = yield* Effect.try({
      try: () => decodeRecoveryRecordJson(recoveryJson),
      catch: (cause) => cause,
    });
    const isRecoveryRecordChanged =
      encodeRecoveryRecordJson(recoveryRecord) !== encodeRecoveryRecordJson(pendingRecoveryRecord(transaction));
    if (isRecoveryRecordChanged) {
      return yield* badArgument("readFile", `Recovery marker ${recoveryPath} changed during the transaction.`);
    }
  });

const holdsState = (current: FileSnapshot, expected: TargetState) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (current._tag === "missing" || expected._tag === "missing") {
      return current._tag === expected._tag;
    }

    const expectedBytes =
      expected._tag === "bytes" ? expected.value : yield* fileSystem.readFile(expected.snapshotPath);
    return bytesEqual(current.bytes, expectedBytes);
  });

type UnchangedCheck = {
  readonly targetPath: string;
  readonly expected: TargetState;
  // Completes the failure message: "changed after <since>".
  readonly since: "it was captured" | "this transaction mutated it";
};

// Fails unless the target still holds the expected state, so no step overwrites bytes someone else changed.
const ensureUnchanged = (transaction: Transaction, check: UnchangedCheck) =>
  Effect.gen(function* () {
    yield* checkTarget(transaction.preparedPlan.root, check.targetPath);
    const current = yield* readFileSnapshot(check.targetPath);
    if (yield* holdsState(current, check.expected)) {
      return;
    }

    return yield* badArgument("stat", `Transaction target ${check.targetPath} changed after ${check.since}.`);
  });

const setMutationState = (transaction: Transaction, mutation: Mutation) =>
  Ref.update(transaction.mutations, (recorded) =>
    recorded.map((candidate) =>
      candidate.snapshot.targetPath === mutation.snapshot.targetPath
        ? { ...candidate, current: mutation.current }
        : candidate,
    ),
  );

// Every step is recorded before the next one, so rollback knows exactly what this transaction left on disk.
const commitTarget = (transaction: Transaction, step: CommitStep) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      if (step.prepared !== undefined) {
        yield* ensureTargetParent(transaction, step.targetPath);
      }

      const snapshot = yield* findSnapshot(transaction, step.targetPath);
      yield* ensureUnchanged(transaction, {
        targetPath: step.targetPath,
        expected: snapshot.original,
        since: "it was captured",
      });
      const preparedBytes = step.prepared === undefined ? undefined : yield* step.prepared.bytes;

      yield* Ref.update(transaction.mutations, (recorded) => [...recorded, { snapshot, current: snapshot.original }]);
      yield* fileSystem.remove(step.targetPath, { force: true });
      yield* setMutationState(transaction, { snapshot, current: { _tag: "missing" } });
      if (step.prepared === undefined || preparedBytes === undefined) {
        return;
      }

      yield* fileSystem.rename(step.prepared.path, step.targetPath);
      yield* setMutationState(transaction, { snapshot, current: { _tag: "bytes", value: preparedBytes } });
    }),
  );

const commitFiles = (transaction: Transaction) =>
  Effect.forEach(
    transaction.preparedPlan.files,
    ({ operation, targetPath, preparedPath }) =>
      commitTarget(transaction, {
        targetPath,
        prepared:
          operation._tag === "remove" ? undefined : { path: preparedPath, bytes: Effect.succeed(operation.bytes) },
      }),
    { discard: true },
  );

const commitReceipt = (transaction: Transaction) => {
  const { operation, targetPath, preparedPath } = transaction.preparedPlan.receipt;
  const readPreparedReceipt = Effect.flatMap(FileSystem.FileSystem, (fileSystem) => fileSystem.readFile(preparedPath));

  return commitTarget(transaction, {
    targetPath,
    prepared: operation._tag === "receiptPublish" ? { path: preparedPath, bytes: readPreparedReceipt } : undefined,
  });
};

const restoreTarget = (transaction: Transaction, mutation: Mutation) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const { targetPath, original } = mutation.snapshot;
    yield* ensureUnchanged(transaction, {
      targetPath,
      expected: mutation.current,
      since: "this transaction mutated it",
    });
    yield* fileSystem.remove(targetPath, { force: true });
    if (original._tag === "file") {
      yield* fileSystem.copyFile(original.snapshotPath, targetPath);
    }
  });

// Undoes recorded mutations newest first and returns the causes of any that could not be undone.
const restoreTargets = (transaction: Transaction) =>
  Effect.gen(function* () {
    const mutations = yield* Ref.get(transaction.mutations);
    const exits = yield* Effect.forEach([...mutations].reverse(), (mutation) =>
      Effect.exit(restoreTarget(transaction, mutation)),
    );

    return failureCauses(exits);
  });

// @effect/platform lacks atomic nonrecursive directory removal.
const removeEmptyDirectory = (directory: string) =>
  Effect.tryPromise({
    try: () => rmdir(directory),
    catch: (cause) =>
      new SystemError({
        reason: "Unknown",
        module: "FileSystem",
        method: "rmdir",
        pathOrDescriptor: directory,
        description: "Could not remove an empty directory.",
        cause,
      }),
  });

const removeCreatedDirectories = (transaction: Transaction) =>
  Effect.gen(function* () {
    const directories = yield* Ref.get(transaction.createdDirectories);
    const deepestFirst = [...new Set(directories)].sort((left, right) => right.length - left.length);

    yield* Effect.forEach(deepestFirst, removeEmptyDirectory, { discard: true });
  });

// Folders that held only removed files are left empty, so remove them too. One that still holds
// anything, or cannot be removed, stays and does not fail the finished transaction.
const removeEmptiedDirectories = (preparedPlan: PreparedPlan) =>
  Effect.gen(function* () {
    const removedPaths = [...preparedPlan.files, preparedPlan.receipt]
      .filter((target) => target.operation._tag === "remove")
      .map((target) => target.targetPath);
    const parents = removedPaths.map((targetPath) => parentDirectories(preparedPlan.root, targetPath));
    const deepestFirst = [...new Set(parents.flat())].sort((left, right) => right.length - left.length);

    yield* Effect.forEach(deepestFirst, (directory) => Effect.ignore(removeEmptyDirectory(directory)), {
      discard: true,
    });
  });

// Unlinks the marker only after proving it is still the one this transaction published.
const releaseMarker = (transaction: Transaction) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* verifyRecoveryMarker(transaction);
    yield* fileSystem.remove(transaction.preparedPlan.receipt.recoveryPath);
    yield* removeTransaction(transaction.preparedPlan);
  });

const cleanupWithoutMarker = (transaction: Transaction) =>
  Effect.zipRight(removeTransaction(transaction.preparedPlan), removeCreatedDirectories(transaction));

const cleanupWithMarker = (transaction: Transaction) =>
  Effect.zipRight(releaseMarker(transaction), removeCreatedDirectories(transaction));

// A failed or defective link may still have published the marker, so clean up by what is on disk.
const cleanupAfterMarkerAttempt = (transaction: Transaction) =>
  Effect.gen(function* () {
    if (yield* pathExists(transaction.preparedPlan.receipt.recoveryPath)) {
      return yield* cleanupWithMarker(transaction);
    }

    return yield* cleanupWithoutMarker(transaction);
  });

const failAfterMarkerAttempt = (transaction: Transaction, cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const cleanupExit = yield* Effect.exit(cleanupAfterMarkerAttempt(transaction));
    if (Exit.isSuccess(cleanupExit)) {
      return yield* Effect.failCause(cause);
    }

    return yield* Effect.failCause(
      combineCauses([cause, cleanupExit.cause, unfinishedChange(transaction.preparedPlan.transactionRoot)]),
    );
  });

// After a commit failure every recorded target is restored. If any restore fails, the marker and
// snapshots stay on disk as recovery evidence and the pending recovery location is reported.
const recoverCommit = (transaction: Transaction, commitCause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const rollbackCauses = yield* restoreTargets(transaction);
    if (rollbackCauses.length === 0) {
      const cleanupExit = yield* Effect.exit(cleanupWithMarker(transaction));
      return yield* Effect.failCause(combineCauses([commitCause, ...failureCauses([cleanupExit])]));
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const retainExit = yield* Effect.exit(
      Effect.zipRight(
        verifyRecoveryMarker(transaction),
        fileSystem.remove(transaction.preparedPlan.preparedDirectory, { recursive: true, force: true }),
      ),
    );

    return yield* Effect.failCause(
      combineCauses([
        commitCause,
        combineCauses(rollbackCauses),
        unfinishedChange(transaction.preparedPlan.receipt.recoveryPath),
        ...failureCauses([retainExit]),
      ]),
    );
  });

// Applies one checked plan as a transaction: capture every target, prepare, commit files, then the receipt.
// A receipt is deletion authority, so it is committed only after every file change has succeeded.
export const applyPlan = (plan: Plan) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const root = yield* restore(checkPlanRoot(plan.root));
      const preparedPlan = yield* preparePlan(plan, root);
      yield* restore(preflightTargets(preparedPlan));
      yield* restore(ensureRecoveryAbsent(preparedPlan.receipt.recoveryPath));
      const snapshots = yield* captureTargets(preparedPlan);
      const transaction: Transaction = {
        preparedPlan,
        snapshots,
        mutations: yield* Ref.make<ReadonlyArray<Mutation>>([]),
        createdDirectories: yield* Ref.make<ReadonlyArray<string>>([]),
      };

      // Stale planning evidence or a preparation failure leaves every destination untouched.
      const preparationExit = yield* Effect.exit(
        restore(Effect.zipRight(validatePlanPreconditions(transaction), prepareTargets(preparedPlan))),
      );
      if (Exit.isFailure(preparationExit)) {
        return yield* failAfter(preparationExit.cause, removeTransaction(preparedPlan));
      }

      const markerExit = yield* Effect.exit(publishRecoveryMarker(transaction));
      if (Exit.isFailure(markerExit)) {
        return yield* failAfterMarkerAttempt(transaction, markerExit.cause);
      }

      if (!markerExit.value) {
        return yield* failAfter(unfinishedChange(preparedPlan.receipt.recoveryPath), cleanupWithoutMarker(transaction));
      }

      const commitExit = yield* Effect.exit(
        restore(Effect.zipRight(commitFiles(transaction), commitReceipt(transaction))),
      );
      if (Exit.isFailure(commitExit)) {
        return yield* recoverCommit(transaction, commitExit.cause);
      }

      yield* releaseMarker(transaction);
      yield* removeEmptiedDirectories(preparedPlan);
    }),
  );
