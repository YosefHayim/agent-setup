import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import { type PlatformError, SystemError } from "@effect/platform/Error";
import { NodeContext, NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { Cause, Deferred, Effect, Either, Exit, Fiber, Layer, Ref } from "effect";

import { applyPlan } from "./apply-plan.js";
import { checkPlan, type ExpectedCurrent, type Plan } from "./plan.js";
import { decodeReceiptJson } from "./receipt.js";
import { decodeRecoveryRecordJson } from "./recovery.js";

const installedHash = "1".repeat(64);
const installedBytes = new TextEncoder().encode("installed");
const originalBytes = new Uint8Array([0, 255, 128, 10]);
const secondOriginalBytes = new TextEncoder().encode("second-original");
const externallyChangedBytes = new TextEncoder().encode("changed after transaction mutation");
const inspectedReceiptBytes = new TextEncoder().encode("receipt inspected during planning");
const changedReceiptBytes = new TextEncoder().encode("receipt changed after planning");
const applicationOwner = { _tag: "application" };
const expectedMissing: ExpectedCurrent = { _tag: "missing" };
const receiptFile = ".agent-setup/receipt.json";
const recoveryFile = ".agent-setup/recovery.json";
const receiptTarget = { path: receiptFile, kind: { _tag: "receipt" }, owner: applicationOwner };

const portablePath = (filePath: string): string => filePath.replaceAll("\\", "/");

const expectedFile = (bytes: Uint8Array): ExpectedCurrent => ({
  _tag: "file",
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

const unwrapPlan = (input: unknown): Plan =>
  Either.getOrThrowWith(checkPlan(input), (error) => new Error(String(error)));

const configFile = (path: string, previous: object = { _tag: "missing" }) => ({
  path,
  kind: { _tag: "managedConfig" },
  owner: applicationOwner,
  ownership: { _tag: "wholeFile", installedHash, previous },
});

const receiptOf = (ownedFiles: ReadonlyArray<object>) => ({
  version: "0.12.0",
  scope: "project",
  features: [],
  ownedFiles,
});

type WritePlanRequest = {
  // Every path is written with installedBytes; the value is the state planning observed there.
  readonly files: Readonly<Record<string, ExpectedCurrent>>;
  readonly receipt?: ExpectedCurrent;
};

const writePlan = (root: string, { files, receipt = expectedMissing }: WritePlanRequest): Plan => {
  const planned = Object.entries(files).map(([path, expectedCurrent]) => ({ file: configFile(path), expectedCurrent }));

  return unwrapPlan({
    scope: "project",
    root,
    operations: planned.map(({ file, expectedCurrent }) => ({
      _tag: "write",
      file,
      bytes: installedBytes,
      expectedCurrent,
    })),
    preconditions: [],
    receipt: {
      _tag: "receiptPublish",
      target: receiptTarget,
      receipt: receiptOf(planned.map(({ file }) => file)),
      expectedCurrent: receipt,
    },
  });
};

const missingFiles = (paths: ReadonlyArray<string>) => Object.fromEntries(paths.map((path) => [path, expectedMissing]));

const receiptRemovalPlan = (root: string, expectedCurrent: ExpectedCurrent): Plan =>
  unwrapPlan({
    scope: "project",
    root,
    operations: [],
    preconditions: [],
    receipt: { _tag: "remove", target: receiptTarget, expectedCurrent },
  });

// A temporary installation root, with shorthands for seeding it and checking what a transaction left behind.
const makeWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-apply-" });
  const at = (relative: string) => path.join(root, relative);

  return {
    fileSystem,
    path,
    root,
    at,
    seed: (files: Readonly<Record<string, Uint8Array>>) =>
      Effect.forEach(
        Object.entries(files),
        ([relative, bytes]) =>
          Effect.zipRight(
            fileSystem.makeDirectory(path.dirname(at(relative)), { recursive: true }),
            fileSystem.writeFile(at(relative), bytes),
          ),
        { discard: true },
      ),
    expectBytes: (relative: string, bytes: Uint8Array) =>
      Effect.map(fileSystem.readFile(at(relative)), (actual) => expect([...actual], relative).toEqual([...bytes])),
    expectAbsent: (relatives: ReadonlyArray<string>) =>
      Effect.forEach(
        relatives,
        (relative) => Effect.map(fileSystem.exists(at(relative)), (exists) => expect(exists, relative).toBe(false)),
        { discard: true },
      ),
    transactionDirectories: Effect.map(fileSystem.readDirectory(root), (entries) =>
      entries.filter((entry) => entry.startsWith(".agent-setup-transaction-")),
    ),
    publishedReceipt: Effect.flatMap(fileSystem.readFileString(at(receiptFile)), (receiptJson) =>
      Effect.try(() => decodeReceiptJson(receiptJson)),
    ),
    recoveryRecord: Effect.flatMap(fileSystem.readFileString(at(recoveryFile)), (recoveryJson) =>
      Effect.try(() => decodeRecoveryRecordJson(recoveryJson)),
    ),
  };
});

const expectFailure = <Value, Failure, Requirements>(effect: Effect.Effect<Value, Failure, Requirements>) =>
  Effect.map(Effect.exit(effect), (exit) => {
    expect(Exit.isFailure(exit)).toBe(true);
    return exit;
  });

type FileSystemPatch = (fileSystem: FileSystem.FileSystem, path: Path.Path) => Partial<FileSystem.FileSystem>;

// The Node platform with some FileSystem methods replaced, to inject faults and races into a transaction.
const patchedPlatform = (patch: FileSystemPatch) =>
  Layer.merge(
    Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        return FileSystem.make({ ...fileSystem, ...patch(fileSystem, yield* Path.Path) });
      }),
    ).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
    NodePath.layer,
  );

const failWith = (method: string, pathOrDescriptor: string) =>
  Effect.fail(
    new SystemError({
      reason: "PermissionDenied",
      module: "FileSystem",
      method,
      pathOrDescriptor,
      description: `Injected ${method} failure.`,
    }),
  );

const named = (filePath: string, name: string) => portablePath(filePath).endsWith(`/${name}`);

// Transaction files live at <root>/.agent-setup-transaction-<id>/<prepared|snapshots>/<name>.
const rootOfTransactionFile = (path: Path.Path, filePath: string) => path.dirname(path.dirname(path.dirname(filePath)));

type Race = (context: {
  root: string;
  fileSystem: FileSystem.FileSystem;
  path: Path.Path;
}) => Effect.Effect<void, PlatformError>;

// Runs the race against the installation root right after the receipt is prepared, before any commit.
const afterReceiptPrepared = (race: Race) =>
  patchedPlatform((fileSystem, path) => ({
    writeFile: (filePath, bytes) =>
      fileSystem
        .writeFile(filePath, bytes)
        .pipe(
          Effect.zipRight(
            portablePath(filePath).endsWith("/prepared/receipt")
              ? race({ root: rootOfTransactionFile(path, filePath), fileSystem, path })
              : Effect.void,
          ),
        ),
  }));

// Fails the commit rename of fail.txt, optionally after changing the workspace first.
const failingCommit = (before?: Race) =>
  patchedPlatform((fileSystem, path) => ({
    rename: (from, to) => {
      if (!named(to, "fail.txt")) {
        return fileSystem.rename(from, to);
      }

      const change = before === undefined ? Effect.void : before({ root: path.dirname(to), fileSystem, path });
      return Effect.zipRight(change, failWith("rename", to));
    },
  }));

layer(NodeContext.layer)("applyPlan", (it) => {
  it.effect("rejects a cross-platform root that is not fully qualified on this host", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const foreignRoot = path.isAbsolute("C:/workspace") ? "/workspace" : "C:/workspace";

      yield* expectFailure(applyPlan(writePlan(foreignRoot, { files: missingFiles(["settings.json"]) })));
    }),
  );

  it.scoped.each([
    {
      name: "file bytes into a new parent directory",
      seeded: {},
      target: "config/settings.json",
      receipt: expectedMissing,
    },
    {
      name: "over present target bytes that still match planning",
      seeded: { "settings.json": originalBytes },
      target: "settings.json",
      receipt: expectedMissing,
    },
    {
      name: "beside a present receipt that still matches planning",
      seeded: { [receiptFile]: inspectedReceiptBytes },
      target: "settings.json",
      receipt: expectedFile(inspectedReceiptBytes),
    },
  ])("commits $name and publishes the receipt", ({ seeded, target, receipt }) =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const seededBytes: Readonly<Record<string, Uint8Array>> = seeded;
      const current = seededBytes[target];
      yield* workspace.seed(seeded);
      const plan = writePlan(workspace.root, {
        files: { [target]: current === undefined ? expectedMissing : expectedFile(current) },
        receipt,
      });

      yield* applyPlan(plan);

      yield* workspace.expectBytes(target, installedBytes);
      expect(yield* workspace.publishedReceipt).toEqual(plan.receipt.receipt);
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }),
  );

  it.scoped.each([
    {
      name: "a receipt that appeared after planning",
      seeded: { [receiptFile]: changedReceiptBytes },
      files: missingFiles(["settings.json"]),
      receipt: expectedMissing,
    },
    {
      name: "receipt bytes changed after planning",
      seeded: { [receiptFile]: changedReceiptBytes },
      files: missingFiles(["settings.json"]),
      receipt: expectedFile(inspectedReceiptBytes),
    },
    {
      name: "a target that appeared after planning",
      seeded: {
        "stable.txt": originalBytes,
        "settings.json": new TextEncoder().encode("appeared after planning"),
        [receiptFile]: inspectedReceiptBytes,
      },
      files: { "stable.txt": expectedFile(originalBytes), "settings.json": expectedMissing },
      receipt: expectedFile(inspectedReceiptBytes),
    },
    {
      name: "target bytes changed after planning",
      seeded: { "settings.json": externallyChangedBytes, [receiptFile]: inspectedReceiptBytes },
      files: { "settings.json": expectedFile(originalBytes) },
      receipt: expectedFile(inspectedReceiptBytes),
    },
  ])("rejects $name without mutating any target", ({ seeded, files, receipt }) =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      yield* workspace.seed(seeded);

      const applyExit = yield* expectFailure(applyPlan(writePlan(workspace.root, { files, receipt })));

      expect(Exit.isFailure(applyExit) && Cause.pretty(applyExit.cause)).toContain(
        "no longer matches the state inspected during planning",
      );
      const seededBytes: Readonly<Record<string, Uint8Array>> = seeded;
      yield* Effect.forEach(Object.entries(seededBytes), ([relative, bytes]) => workspace.expectBytes(relative, bytes));
      yield* workspace.expectAbsent(Object.keys(files).filter((relative) => !(relative in seededBytes)));
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }),
  );

  it.scoped("rejects a changed receipt from a serialized removal plan", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const plan = receiptRemovalPlan(workspace.root, expectedFile(inspectedReceiptBytes));
      yield* workspace.seed({ [receiptFile]: changedReceiptBytes });

      yield* expectFailure(applyPlan(unwrapPlan(JSON.parse(JSON.stringify(plan)))));

      yield* workspace.expectBytes(receiptFile, changedReceiptBytes);
    }),
  );

  it.scoped("guards unchanged owned targets before committing another file", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const stableFile = configFile("stable.txt");
      const changedFile = configFile("changed.txt");
      const plan = unwrapPlan({
        scope: "project",
        root: workspace.root,
        operations: [{ _tag: "write", file: changedFile, bytes: installedBytes, expectedCurrent: expectedMissing }],
        preconditions: [{ path: stableFile.path, expectedCurrent: expectedFile(originalBytes) }],
        receipt: {
          _tag: "receiptPublish",
          target: receiptTarget,
          receipt: receiptOf([stableFile, changedFile]),
          expectedCurrent: expectedMissing,
        },
      });
      yield* workspace.seed({ "stable.txt": externallyChangedBytes });

      yield* expectFailure(applyPlan(plan));

      yield* workspace.expectBytes("stable.txt", externallyChangedBytes);
      yield* workspace.expectAbsent(["changed.txt", receiptFile]);
    }),
  );

  it.scoped("refuses to start while durable recovery evidence is pending", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const pendingRecovery = new TextEncoder().encode("pending recovery");
      yield* workspace.seed({ [recoveryFile]: pendingRecovery });

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files: missingFiles(["config/settings.json"]) })));

      yield* workspace.expectAbsent(["config/settings.json"]);
      yield* workspace.expectBytes(recoveryFile, pendingRecovery);
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }),
  );

  it.scoped("rejects a symlinked parent before creating transaction state", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const outside = yield* workspace.fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-apply-outside-" });
      yield* workspace.fileSystem.symlink(outside, workspace.at("link"));

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files: missingFiles(["link/escaped.json"]) })));

      expect(yield* workspace.fileSystem.exists(workspace.path.join(outside, "escaped.json"))).toBe(false);
      yield* workspace.expectAbsent([receiptFile]);
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }),
  );

  it.scoped("applies write, restore, and remove operations before publishing ownership", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const writtenFile = configFile("write.txt");
      const plan = unwrapPlan({
        scope: "project",
        root: workspace.root,
        operations: [
          { _tag: "write", file: writtenFile, bytes: installedBytes, expectedCurrent: expectedMissing },
          {
            _tag: "restore",
            file: configFile("restore.txt", { _tag: "priorFile", bytes: originalBytes }),
            bytes: originalBytes,
            expectedCurrent: expectedFile(installedBytes),
          },
          {
            _tag: "remove",
            file: configFile("remove.txt"),
            unownedBytes: new Uint8Array(),
            expectedCurrent: expectedFile(installedBytes),
          },
        ],
        preconditions: [],
        receipt: {
          _tag: "receiptPublish",
          target: receiptTarget,
          receipt: receiptOf([writtenFile]),
          expectedCurrent: expectedMissing,
        },
      });
      yield* workspace.seed({ "restore.txt": installedBytes, "remove.txt": installedBytes });

      yield* applyPlan(plan);

      yield* workspace.expectBytes("write.txt", installedBytes);
      yield* workspace.expectBytes("restore.txt", originalBytes);
      yield* workspace.expectAbsent(["remove.txt"]);
      expect((yield* workspace.publishedReceipt).ownedFiles.map((file) => file.path)).toEqual(["write.txt"]);
    }),
  );

  it.scoped("removes the ownership receipt for a completed uninstall plan", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const previousReceiptBytes = new TextEncoder().encode("previous receipt");
      yield* workspace.seed({ [receiptFile]: previousReceiptBytes });

      yield* applyPlan(receiptRemovalPlan(workspace.root, expectedFile(previousReceiptBytes)));

      yield* workspace.expectAbsent([receiptFile]);
    }),
  );
});

describe("applyPlan under injected filesystem faults", () => {
  const transactionOrderPlatform = patchedPlatform((fileSystem, path) => {
    const log = (transactionFile: string, event: string) =>
      fileSystem.writeFileString(
        path.join(rootOfTransactionFile(path, transactionFile), ".transaction-order.log"),
        `${event}\n`,
        { flag: "a" },
      );

    return {
      copyFile: (from, to) =>
        fileSystem
          .copyFile(from, to)
          .pipe(
            Effect.zipRight(
              portablePath(from).includes("/snapshots/") ? log(from, `restore:${path.basename(to)}`) : Effect.void,
            ),
          ),
      rename: (from, to) =>
        path.basename(to) === "fail.txt"
          ? failWith("rename", to)
          : fileSystem.rename(from, to).pipe(Effect.zipRight(log(from, `commit:${path.basename(to)}`))),
    };
  });

  it.scoped("commits the ownership receipt after every file", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;

      yield* applyPlan(writePlan(workspace.root, { files: missingFiles(["first.txt", "second.txt"]) }));

      const log = (yield* workspace.fileSystem.readFileString(workspace.at(".transaction-order.log")))
        .trim()
        .split("\n");
      expect(log).toEqual(["commit:first.txt", "commit:second.txt", "commit:receipt.json"]);
    }).pipe(Effect.provide(transactionOrderPlatform)),
  );

  it.scoped("restores captured targets in reverse mutation order", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const seeded = { "first.txt": originalBytes, "second.txt": secondOriginalBytes, "fail.txt": originalBytes };
      yield* workspace.seed(seeded);
      const files = Object.fromEntries(
        Object.entries(seeded).map(([relative, bytes]) => [relative, expectedFile(bytes)]),
      );

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files })));

      const log = (yield* workspace.fileSystem.readFileString(workspace.at(".transaction-order.log")))
        .trim()
        .split("\n");
      expect(log).toEqual([
        "commit:first.txt",
        "commit:second.txt",
        "restore:fail.txt",
        "restore:second.txt",
        "restore:first.txt",
      ]);
    }).pipe(Effect.provide(transactionOrderPlatform)),
  );

  it.scoped.each([
    { name: "between atomic file commits", pausedAt: "first.txt", targets: ["first.txt", "second.txt"] },
    { name: "inside the atomic receipt commit", pausedAt: "receipt.json", targets: ["settings.json"] },
  ])("rolls back when interrupted $name", ({ pausedAt, targets }) =>
    Effect.gen(function* () {
      const committed = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const pausedPlatform = patchedPlatform((fileSystem) => ({
        rename: (from, to) =>
          named(to, pausedAt)
            ? fileSystem.rename(from, to).pipe(
                Effect.tap(() => Deferred.succeed(committed, undefined)),
                Effect.zipRight(Deferred.await(release)),
              )
            : fileSystem.rename(from, to),
      }));

      yield* Effect.gen(function* () {
        const workspace = yield* makeWorkspace;
        const applyFiber = yield* Effect.fork(applyPlan(writePlan(workspace.root, { files: missingFiles(targets) })));

        yield* Deferred.await(committed);
        const interruption = yield* Effect.fork(Fiber.interrupt(applyFiber));
        yield* Effect.yieldNow();
        yield* Deferred.succeed(release, undefined);
        const applyExit = yield* Fiber.join(interruption);

        expect(Exit.isFailure(applyExit) && Cause.isInterruptedOnly(applyExit.cause)).toBe(true);
        yield* workspace.expectAbsent([...targets, receiptFile, recoveryFile]);
        expect(yield* workspace.transactionDirectories).toEqual([]);
      }).pipe(Effect.provide(pausedPlatform));
    }),
  );

  it.scoped("rejects a parent swapped to an outside symlink before commit", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const outside = `${workspace.root}-outside`;
      yield* workspace.fileSystem.makeDirectory(workspace.at("safe"));
      yield* workspace.fileSystem.makeDirectory(outside);
      yield* Effect.addFinalizer(() => workspace.fileSystem.remove(outside, { recursive: true, force: true }));

      yield* expectFailure(
        applyPlan(writePlan(workspace.root, { files: missingFiles(["first.txt", "safe/escaped.json"]) })),
      );

      yield* workspace.expectAbsent(["first.txt", receiptFile]);
      expect(yield* workspace.fileSystem.exists(workspace.path.join(outside, "escaped.json"))).toBe(false);
    }).pipe(
      Effect.provide(
        afterReceiptPrepared(({ root, fileSystem, path }) =>
          Effect.zipRight(
            fileSystem.rename(path.join(root, "safe"), path.join(root, "safe-before-swap")),
            fileSystem.symlink(`${root}-outside`, path.join(root, "safe")),
          ),
        ),
      ),
    ),
  );

  it.scoped("never publishes the recovery marker through a swapped parent", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const outside = `${workspace.root}-recovery-outside`;
      yield* workspace.fileSystem.makeDirectory(workspace.at(".agent-setup"));
      yield* workspace.fileSystem.makeDirectory(outside);
      yield* Effect.addFinalizer(() => workspace.fileSystem.remove(outside, { recursive: true, force: true }));

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files: missingFiles(["settings.json"]) })));

      yield* workspace.expectAbsent(["settings.json"]);
      expect(yield* workspace.fileSystem.exists(workspace.path.join(outside, "recovery.json"))).toBe(false);
      expect(yield* workspace.fileSystem.exists(workspace.path.join(outside, "receipt.json"))).toBe(false);
    }).pipe(
      Effect.provide(
        afterReceiptPrepared(({ root, fileSystem, path }) =>
          Effect.zipRight(
            fileSystem.rename(path.join(root, ".agent-setup"), path.join(root, ".agent-setup-before-swap")),
            fileSystem.symlink(`${root}-recovery-outside`, path.join(root, ".agent-setup")),
          ),
        ),
      ),
    ),
  );

  it.scoped.each([
    {
      name: "fails",
      markerLink: () => (_from: string, to: string) => failWith("link", to),
      cause: "Injected link failure",
    },
    {
      name: "defects after linking",
      markerLink: (fileSystem: FileSystem.FileSystem) => (from: string, to: string) =>
        fileSystem.link(from, to).pipe(Effect.zipRight(Effect.dieMessage("Injected post-link defect."))),
      cause: "Injected post-link defect",
    },
  ])("cleans up without mutating destinations when recovery marker publication $name", ({ markerLink, cause }) =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;

      const applyExit = yield* expectFailure(
        applyPlan(writePlan(workspace.root, { files: missingFiles(["settings.json"]) })),
      );

      expect(Exit.isFailure(applyExit) && Cause.pretty(applyExit.cause)).toContain(cause);
      yield* workspace.expectAbsent(["settings.json", receiptFile, recoveryFile]);
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }).pipe(
      Effect.provide(
        patchedPlatform((fileSystem) => ({
          link: (from, to) =>
            named(to, "recovery.json") ? markerLink(fileSystem)(from, to) : fileSystem.link(from, to),
        })),
      ),
    ),
  );

  it.scoped("removes the losing transaction without touching the winning marker", () =>
    Effect.gen(function* () {
      const releaseWinner = yield* Deferred.make<void>();
      const bothWritersReady = yield* Deferred.make<void>();
      const linkArrivals = yield* Ref.make(0);
      // Both writers reach the marker link together; the winner then holds the marker until released.
      const competingPlatform = patchedPlatform((fileSystem) => ({
        link: (from, to) =>
          named(to, "recovery.json")
            ? Effect.gen(function* () {
                if ((yield* Ref.updateAndGet(linkArrivals, (count) => count + 1)) === 2) {
                  yield* Deferred.succeed(bothWritersReady, undefined);
                }
                yield* Deferred.await(bothWritersReady);
                yield* fileSystem.link(from, to);
                yield* Deferred.await(releaseWinner);
              })
            : fileSystem.link(from, to),
      }));

      yield* Effect.gen(function* () {
        const workspace = yield* makeWorkspace;
        const plan = writePlan(workspace.root, { files: { "settings.json": expectedFile(originalBytes) } });
        yield* workspace.fileSystem.makeDirectory(workspace.at(".agent-setup"));
        yield* workspace.seed({ "settings.json": originalBytes });

        const firstWriter = yield* Effect.fork(Effect.exit(applyPlan(plan)));
        const secondWriter = yield* Effect.fork(Effect.exit(applyPlan(plan)));
        const loserExit = yield* Effect.race(Fiber.join(firstWriter), Fiber.join(secondWriter));

        yield* Effect.gen(function* () {
          expect(Exit.isFailure(loserExit)).toBe(true);
          expect(yield* workspace.fileSystem.exists(workspace.at(recoveryFile))).toBe(true);
          expect(yield* workspace.transactionDirectories).toHaveLength(1);
        }).pipe(Effect.ensuring(Deferred.succeed(releaseWinner, undefined)));

        const writerExits = yield* Effect.all([Fiber.join(firstWriter), Fiber.join(secondWriter)]);

        expect(writerExits.filter(Exit.isSuccess)).toHaveLength(1);
        expect(writerExits.filter(Exit.isFailure)).toHaveLength(1);
        yield* workspace.expectBytes("settings.json", installedBytes);
        expect(yield* workspace.publishedReceipt).toEqual(plan.receipt.receipt);
        yield* workspace.expectAbsent([recoveryFile]);
        expect(yield* workspace.transactionDirectories).toEqual([]);
      }).pipe(Effect.provide(competingPlatform));
    }),
  );

  it.scoped("preserves bytes changed after capture instead of overwriting them", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      yield* workspace.seed({ "changed.txt": originalBytes });

      yield* expectFailure(
        applyPlan(
          writePlan(workspace.root, {
            files: { "first.txt": expectedMissing, "changed.txt": expectedFile(originalBytes) },
          }),
        ),
      );

      yield* workspace.expectAbsent(["first.txt", receiptFile]);
      yield* workspace.expectBytes("changed.txt", externallyChangedBytes);
    }).pipe(
      Effect.provide(
        afterReceiptPrepared(({ root, fileSystem, path }) =>
          fileSystem.writeFile(path.join(root, "changed.txt"), externallyChangedBytes),
        ),
      ),
    ),
  );

  it.scoped("restores original bytes and removes created parents after a middle commit failure", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      yield* workspace.seed({ "existing.txt": originalBytes });
      const files = {
        "existing.txt": expectedFile(originalBytes),
        "created/nested/file.txt": expectedMissing,
        "fail.txt": expectedMissing,
      };

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files })));

      yield* workspace.expectBytes("existing.txt", originalBytes);
      yield* workspace.expectAbsent(["created", "fail.txt", receiptFile]);
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }).pipe(Effect.provide(failingCommit())),
  );

  it.scoped("removes snapshots while preserving external content in a created parent", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;

      yield* expectFailure(
        applyPlan(writePlan(workspace.root, { files: missingFiles(["created/nested/file.txt", "fail.txt"]) })),
      );

      yield* workspace.expectBytes("created/nested/external.txt", externallyChangedBytes);
      yield* workspace.expectAbsent([receiptFile, recoveryFile]);
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }).pipe(
      Effect.provide(
        failingCommit(({ root, fileSystem, path }) =>
          fileSystem.writeFile(path.join(root, "created/nested/external.txt"), externallyChangedBytes),
        ),
      ),
    ),
  );

  it.scoped("retains recovery state instead of overwriting bytes changed after commit", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files: missingFiles(["first.txt", "fail.txt"]) })));

      yield* workspace.expectBytes("first.txt", externallyChangedBytes);
      yield* workspace.expectAbsent([receiptFile]);
      expect(yield* workspace.fileSystem.exists((yield* workspace.recoveryRecord).transactionRoot)).toBe(true);
    }).pipe(
      Effect.provide(
        failingCommit(({ root, fileSystem, path }) =>
          fileSystem.writeFile(path.join(root, "first.txt"), externallyChangedBytes),
        ),
      ),
    ),
  );

  it.scoped("rolls files back and restores the prior receipt bytes after the receipt commit fails", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      const priorReceiptBytes = new Uint8Array([255, 0, 1, 128]);
      yield* workspace.seed({ "existing.txt": originalBytes, [receiptFile]: priorReceiptBytes });

      const applyExit = yield* expectFailure(
        applyPlan(
          writePlan(workspace.root, {
            files: { "existing.txt": expectedFile(originalBytes) },
            receipt: expectedFile(priorReceiptBytes),
          }),
        ),
      );

      expect(Exit.isFailure(applyExit) && Cause.pretty(applyExit.cause)).toContain("Injected rename failure");
      yield* workspace.expectBytes("existing.txt", originalBytes);
      yield* workspace.expectBytes(receiptFile, priorReceiptBytes);
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }).pipe(
      Effect.provide(
        patchedPlatform((fileSystem) => ({
          rename: (from, to) => (named(to, "receipt.json") ? failWith("rename", to) : fileSystem.rename(from, to)),
        })),
      ),
    ),
  );

  it.scoped.each([
    {
      name: "preparing",
      failed: "second.txt",
      patch: ((fileSystem) => ({
        writeFile: (filePath, bytes) =>
          portablePath(filePath).includes("/prepared/1")
            ? failWith("writeFile", filePath)
            : fileSystem.writeFile(filePath, bytes),
      })) satisfies FileSystemPatch,
    },
    {
      name: "capturing a snapshot",
      failed: "snapshot-fail.txt",
      patch: ((fileSystem) => ({
        readFile: (filePath) =>
          named(filePath, "snapshot-fail.txt") ? failWith("readFile", filePath) : fileSystem.readFile(filePath),
      })) satisfies FileSystemPatch,
    },
  ])("leaves every destination unchanged and removes transaction state when $name fails", ({ failed, patch }) =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      yield* workspace.seed({ "first.txt": originalBytes, [failed]: secondOriginalBytes });
      const files = { "first.txt": expectedFile(originalBytes), [failed]: expectedFile(secondOriginalBytes) };

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files })));

      yield* workspace.expectBytes("first.txt", originalBytes);
      expect((yield* workspace.fileSystem.stat(workspace.at(failed))).type).toBe("File");
      yield* workspace.expectAbsent([receiptFile]);
      expect(yield* workspace.transactionDirectories).toEqual([]);
    }).pipe(Effect.provide(patchedPlatform(patch))),
  );

  it.scoped("surfaces cleanup failure without rolling back the committed receipt", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files: missingFiles(["settings.json"]) })));

      yield* workspace.expectBytes("settings.json", installedBytes);
      expect(yield* workspace.fileSystem.exists(workspace.at(receiptFile))).toBe(true);
      yield* workspace.expectAbsent([recoveryFile]);
      expect(yield* workspace.transactionDirectories).toHaveLength(1);
    }).pipe(
      Effect.provide(
        patchedPlatform((fileSystem) => ({
          remove: (filePath, options) =>
            portablePath(filePath).includes("/.agent-setup-transaction-") && options?.recursive === true
              ? failWith("remove", filePath)
              : fileSystem.remove(filePath, options),
        })),
      ),
    ),
  );

  it.scoped("retains the recovery marker and snapshots after committed cleanup fails", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files: missingFiles(["settings.json"]) })));

      yield* workspace.expectBytes("settings.json", installedBytes);
      expect(yield* workspace.fileSystem.exists(workspace.at(receiptFile))).toBe(true);
      expect(yield* workspace.fileSystem.exists((yield* workspace.recoveryRecord).transactionRoot)).toBe(true);
    }).pipe(
      Effect.provide(
        patchedPlatform((fileSystem) => ({
          remove: (filePath, options) =>
            portablePath(filePath).endsWith(`/${recoveryFile}`)
              ? failWith("remove", filePath)
              : fileSystem.remove(filePath, options),
        })),
      ),
    ),
  );

  it.scoped("never unlinks a marker that changed before committed cleanup", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;

      yield* expectFailure(applyPlan(writePlan(workspace.root, { files: missingFiles(["settings.json"]) })));

      expect(yield* workspace.fileSystem.exists(workspace.at(receiptFile))).toBe(true);
      expect(yield* workspace.fileSystem.readFileString(workspace.at(recoveryFile))).toBe("changed marker");
      expect(yield* workspace.transactionDirectories).toHaveLength(1);
    }).pipe(
      Effect.provide(
        patchedPlatform((fileSystem, path) => ({
          rename: (from, to) =>
            fileSystem
              .rename(from, to)
              .pipe(
                Effect.zipRight(
                  path.basename(to) === "receipt.json"
                    ? fileSystem.writeFileString(path.join(path.dirname(to), "recovery.json"), "changed marker")
                    : Effect.void,
                ),
              ),
        })),
      ),
    ),
  );

  const rollbackFailurePlatform = patchedPlatform((fileSystem) => ({
    copyFile: (from, to) => (named(to, "existing.txt") ? failWith("copyFile", to) : fileSystem.copyFile(from, to)),
    rename: (from, to) => (named(to, "fail.txt") ? failWith("rename", to) : fileSystem.rename(from, to)),
  }));

  const failedRollbackPlan = (root: string) =>
    writePlan(root, { files: { "existing.txt": expectedFile(originalBytes), "fail.txt": expectedMissing } });

  it.scoped("retains snapshots and writes strict durable recovery evidence when rollback fails", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      yield* workspace.seed({ "existing.txt": originalBytes });

      const applyExit = yield* expectFailure(applyPlan(failedRollbackPlan(workspace.root)));

      expect(Exit.isFailure(applyExit) && Cause.pretty(applyExit.cause)).toContain("Injected rename failure");
      expect(Exit.isFailure(applyExit) && Cause.pretty(applyExit.cause)).toContain("Injected copyFile failure");
      yield* workspace.expectAbsent(["existing.txt", receiptFile]);

      const recovery = yield* workspace.recoveryRecord;
      const canonicalRoot = yield* workspace.fileSystem.realPath(workspace.root);
      const canonicalOriginalPath = workspace.path.join(canonicalRoot, "existing.txt");
      expect(recovery._tag).toBe("pending");
      expect(recovery.root).toBe(canonicalRoot);
      expect(recovery.receiptPath).toBe(workspace.path.join(canonicalRoot, receiptFile));
      expect(yield* workspace.fileSystem.exists(recovery.transactionRoot)).toBe(true);
      expect(yield* workspace.fileSystem.exists(workspace.path.join(recovery.transactionRoot, "prepared"))).toBe(false);

      const snapshot = recovery.snapshots.find((candidate) => candidate.targetPath === canonicalOriginalPath);
      expect(snapshot?.original._tag).toBe("file");
      if (snapshot?.original._tag === "file") {
        expect([...(yield* workspace.fileSystem.readFile(snapshot.original.snapshotPath))]).toEqual([...originalBytes]);
      }
    }).pipe(Effect.provide(rollbackFailurePlatform)),
  );

  it.scoped.skipIf(process.platform === "win32")("keeps retained recovery state private on POSIX hosts", () =>
    Effect.gen(function* () {
      const workspace = yield* makeWorkspace;
      yield* workspace.fileSystem.writeFile(workspace.at("existing.txt"), originalBytes, { mode: 0o600 });

      yield* Effect.exit(applyPlan(failedRollbackPlan(workspace.root)));

      const recovery = yield* workspace.recoveryRecord;
      const snapshot = recovery.snapshots.find((candidate) => candidate.targetPath.endsWith("/existing.txt"));
      const modeOf = (filePath: string) => Effect.map(workspace.fileSystem.stat(filePath), (stat) => stat.mode & 0o777);
      expect(yield* modeOf(recovery.transactionRoot)).toBe(0o700);
      expect(yield* modeOf(workspace.path.join(recovery.transactionRoot, "pending.json"))).toBe(0o600);
      expect(snapshot?.original._tag).toBe("file");
      if (snapshot?.original._tag === "file") {
        expect(yield* modeOf(snapshot.original.snapshotPath)).toBe(0o600);
      }
    }).pipe(Effect.provide(rollbackFailurePlatform)),
  );
});
