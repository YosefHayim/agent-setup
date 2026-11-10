import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyPlan } from "./apply-plan.js";
import { checkPlan, type ExpectedCurrent, type Plan } from "./plan.js";
import { decodeReceiptDocument } from "./receipt.js";
import { decodeRecoveryDocument } from "./recovery.js";

// Every fs/promises call the transaction makes goes through aroundCall, so a test can fail or hold one call.
const injected = vi.hoisted(() => {
  const passThroughCall = (_method: string, _argumentList: ReadonlyArray<unknown>, run: () => Promise<unknown>) =>
    run();

  return { passThroughCall, aroundCall: passThroughCall };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    copyFile: (...argumentList: Parameters<typeof actual.copyFile>) =>
      injected.aroundCall("copyFile", argumentList, () => actual.copyFile(...argumentList)),
    link: (...callArguments: Parameters<typeof actual.link>) =>
      injected.aroundCall("link", callArguments, () => actual.link(...callArguments)),
    readFile: (...callArguments: Parameters<typeof actual.readFile>) =>
      injected.aroundCall("readFile", callArguments, () => actual.readFile(...callArguments)),
    rename: (...callArguments: Parameters<typeof actual.rename>) =>
      injected.aroundCall("rename", callArguments, () => actual.rename(...callArguments)),
    rm: (...callArguments: Parameters<typeof actual.rm>) =>
      injected.aroundCall("rm", callArguments, () => actual.rm(...callArguments)),
    writeFile: (...callArguments: Parameters<typeof actual.writeFile>) =>
      injected.aroundCall("writeFile", callArguments, () => actual.writeFile(...callArguments)),
  };
});

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

const createForwardSlashPath = (filePath: string): string => filePath.replaceAll("\\", "/");

const neverAbortedSignal = new AbortController().signal;

// Runs a plan that nobody aborts. The interrupt test passes its own controller instead.
const applyPlanUninterrupted = (plan: Plan): Promise<void> => applyPlan(plan, neverAbortedSignal);

const readFileName = (field: unknown): string => basename(String(field));

// Transaction files live at <root>/.agent-setup-transaction-<id>/<prepared|snapshots>/<name>.
const findRootOfTransactionFile = (filePath: string): string => dirname(dirname(dirname(filePath)));

const createExpectedFile = (bytes: Uint8Array): ExpectedCurrent => ({
  _tag: "file",
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

const createSettingsFile = (path: string, previous: object = { _tag: "missing" }) => ({
  path,
  kind: { _tag: "managedConfig" },
  owner: applicationOwner,
  ownership: { _tag: "wholeFile", installedHash, previous },
});

const createReceipt = (ownedFiles: ReadonlyArray<object>) => ({
  version: "0.12.0",
  scope: "project",
  features: [],
  ownedFiles,
});

interface WritePlanRequest {
  // Every path is written with installedBytes; the value is the state planning observed there.
  readonly files: Readonly<Record<string, ExpectedCurrent>>;
  readonly receipt?: ExpectedCurrent;
}

const createWritePlan = (root: string, { files, receipt = expectedMissing }: WritePlanRequest): Plan => {
  const planned = Object.entries(files).map(([path, expectedCurrent]) => ({
    file: createSettingsFile(path),
    expectedCurrent,
  }));

  return checkPlan({
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
      receipt: createReceipt(planned.map(({ file }) => file)),
      expectedCurrent: receipt,
    },
  });
};

const createMissingFiles = (paths: ReadonlyArray<string>) =>
  Object.fromEntries(paths.map((path) => [path, expectedMissing]));

const createReceiptRemovalPlan = (root: string, expectedCurrent: ExpectedCurrent): Plan =>
  checkPlan({
    scope: "project",
    root,
    operations: [],
    preconditions: [],
    receipt: { _tag: "remove", target: receiptTarget, expectedCurrent },
  });

const temporaryDirectories: Array<string> = [];

const createTemporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);

  return directory;
};

const seedFiles = (root: string, files: Readonly<Record<string, Uint8Array>>): void => {
  for (const [relative, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), bytes);
  }
};

const expectFileBytes = (root: string, relative: string, bytes: Uint8Array): void => {
  expect([...readFileSync(join(root, relative))], relative).toEqual([...bytes]);
};

const expectMissingPaths = (root: string, relatives: ReadonlyArray<string>): void => {
  for (const relative of relatives) {
    expect(existsSync(join(root, relative)), relative).toBe(false);
  }
};

const listTransactionDirectories = (root: string): Array<string> =>
  readdirSync(root).filter((line) => line.startsWith(".agent-setup-transaction-"));

const readPublishedReceipt = (root: string) => decodeReceiptDocument(readFileSync(join(root, receiptFile), "utf8"));

const readRecovery = (root: string) => decodeRecoveryDocument(readFileSync(join(root, recoveryFile), "utf8"));

// Collects the message of a failure and of every failure it groups, so a test can find any one of them.
const describeFailure = (failure: unknown): string => {
  const isPlainError = failure instanceof Error;
  const ownMessage = isPlainError ? failure.message : String(failure);

  const isAggregateFailure = failure instanceof AggregateError;
  const groupedMessages = isAggregateFailure ? failure.errors.map(describeFailure) : [];

  return [ownMessage, ...groupedMessages].join("\n");
};

const catchFailure = async (operation: Promise<unknown>): Promise<unknown> => {
  try {
    await operation;
  } catch (failure) {
    return failure;
  }

  throw new Error("Expected the operation to fail.");
};

type Settlement = { readonly _tag: "fulfilled" } | { readonly _tag: "rejected"; readonly failure: unknown };

const settleOperation = async (operation: Promise<unknown>): Promise<Settlement> => {
  try {
    await operation;
    return { _tag: "fulfilled" };
  } catch (failure) {
    return { _tag: "rejected", failure };
  }
};

interface Gate {
  readonly wait: Promise<void>;
  readonly open: () => void;
}

// A gate the test opens by hand, so a transaction can be held at one exact call.
const createGate = (): Gate => {
  const opener: { open: () => void } = { open: () => undefined };
  const wait = new Promise<void>((markOpen) => {
    opener.open = () => markOpen();
  });

  return { wait, open: () => opener.open() };
};

const createInjectedFailure = (method: string): Error => new Error(`Injected ${method} failure.`);

// Makes every call the predicate picks fail with an injected error; other calls run normally.
const failCallsWhen = (isFailingCall: (method: string, argumentList: ReadonlyArray<unknown>) => boolean): void => {
  injected.aroundCall = async (method, callArguments, run) => {
    if (isFailingCall(method, callArguments)) {
      throw createInjectedFailure(method);
    }

    return run();
  };
};

// Runs the race against the installation root right after the receipt is prepared, before any commit.
const createRaceAfterReceiptPrepared = (race: (root: string) => void): void => {
  injected.aroundCall = async (method, argumentList, run) => {
    const callReply = await run();
    const preparedReceiptPath = createForwardSlashPath(String(argumentList[0]));

    const isPreparedReceiptWrite = method === "writeFile" && preparedReceiptPath.endsWith("/prepared/receipt");
    if (isPreparedReceiptWrite) {
      race(findRootOfTransactionFile(String(argumentList[0])));
    }

    return callReply;
  };
};

// Fails the commit rename of fail.txt, optionally after changing the workspace first.
const failCommitOfFailFile = (beforeFailure?: (root: string) => void): void => {
  injected.aroundCall = async (method, argumentList, run) => {
    const isFailingCommit = method === "rename" && readFileName(argumentList[1]) === "fail.txt";
    if (isFailingCommit) {
      beforeFailure?.(dirname(String(argumentList[1])));
      throw createInjectedFailure("rename");
    }

    return run();
  };
};

// Logs each commit and each restore in order, and fails the commit of fail.txt.
const saveTransactionOrder = (): void => {
  const appendOrder = (filePath: string, event: string) =>
    appendFileSync(join(findRootOfTransactionFile(filePath), ".transaction-order.log"), `${event}\n`);

  const saveCommit = async (argumentList: ReadonlyArray<unknown>, run: () => Promise<unknown>): Promise<unknown> => {
    const isFailingCommit = readFileName(argumentList[1]) === "fail.txt";
    if (isFailingCommit) {
      throw createInjectedFailure("rename");
    }

    const commitReply = await run();
    appendOrder(String(argumentList[0]), `commit:${readFileName(argumentList[1])}`);

    return commitReply;
  };

  injected.aroundCall = async (method, callArguments, run) => {
    const isRestore = method === "copyFile" && createForwardSlashPath(String(callArguments[0])).includes("/snapshots/");
    if (isRestore) {
      const restoreReply = await run();
      appendOrder(String(callArguments[0]), `restore:${readFileName(callArguments[1])}`);

      return restoreReply;
    }

    const isCommit = method === "rename";
    if (isCommit) {
      return saveCommit(callArguments, run);
    }

    return run();
  };
};

const readTransactionOrder = (root: string): Array<string> =>
  readFileSync(join(root, ".transaction-order.log"), "utf8").trim().split("\n");

const createFailedRollbackPlan = (root: string): Plan =>
  createWritePlan(root, { files: { "existing.txt": createExpectedFile(originalBytes), "fail.txt": expectedMissing } });

const failRollbackOfExistingFile = (): void => {
  failCallsWhen(
    (method, argumentList) =>
      (method === "copyFile" && readFileName(argumentList[1]) === "existing.txt") ||
      (method === "rename" && readFileName(argumentList[1]) === "fail.txt"),
  );
};

afterEach(() => {
  injected.aroundCall = injected.passThroughCall;
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe("applyPlan", () => {
  it("rejects a cross-platform root that is not fully qualified on this host", async () => {
    const foreignRoot = isAbsolute("C:/workspace") ? "/workspace" : "C:/workspace";

    await catchFailure(
      applyPlanUninterrupted(createWritePlan(foreignRoot, { files: createMissingFiles(["settings.json"]) })),
    );
  });

  it.each([
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
      receipt: createExpectedFile(inspectedReceiptBytes),
    },
  ])("commits $name and publishes the receipt", async ({ seeded, target, receipt }) => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const seededBytes: Readonly<Record<string, Uint8Array>> = seeded;
    const currentBytes: Uint8Array | undefined = seededBytes[target];
    const isTargetPresent = currentBytes != null;
    seedFiles(root, seededBytes);
    const plan = createWritePlan(root, {
      files: { [target]: isTargetPresent ? createExpectedFile(currentBytes) : expectedMissing },
      receipt,
    });

    await applyPlanUninterrupted(plan);

    expectFileBytes(root, target, installedBytes);
    expect(readPublishedReceipt(root)).toEqual(plan.receipt.receipt);
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it.each([
    {
      name: "a receipt that appeared after planning",
      seeded: { [receiptFile]: changedReceiptBytes },
      files: createMissingFiles(["settings.json"]),
      receipt: expectedMissing,
    },
    {
      name: "receipt bytes changed after planning",
      seeded: { [receiptFile]: changedReceiptBytes },
      files: createMissingFiles(["settings.json"]),
      receipt: createExpectedFile(inspectedReceiptBytes),
    },
    {
      name: "a target that appeared after planning",
      seeded: {
        "stable.txt": originalBytes,
        "settings.json": new TextEncoder().encode("appeared after planning"),
        [receiptFile]: inspectedReceiptBytes,
      },
      files: { "stable.txt": createExpectedFile(originalBytes), "settings.json": expectedMissing },
      receipt: createExpectedFile(inspectedReceiptBytes),
    },
    {
      name: "target bytes changed after planning",
      seeded: { "settings.json": externallyChangedBytes, [receiptFile]: inspectedReceiptBytes },
      files: { "settings.json": createExpectedFile(originalBytes) },
      receipt: createExpectedFile(inspectedReceiptBytes),
    },
  ])("rejects $name without mutating any target", async ({ seeded, files, receipt }) => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const seededBytes: Readonly<Record<string, Uint8Array>> = seeded;
    seedFiles(root, seededBytes);

    const failure = await catchFailure(applyPlanUninterrupted(createWritePlan(root, { files, receipt })));

    expect(describeFailure(failure)).toContain("no longer matches the state inspected during planning");
    for (const [relative, bytes] of Object.entries(seededBytes)) {
      expectFileBytes(root, relative, bytes);
    }
    expectMissingPaths(
      root,
      Object.keys(files).filter((relative) => !(relative in seededBytes)),
    );
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it("rejects a changed receipt from a serialized removal plan", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const plan = createReceiptRemovalPlan(root, createExpectedFile(inspectedReceiptBytes));
    seedFiles(root, { [receiptFile]: changedReceiptBytes });

    await catchFailure(applyPlanUninterrupted(checkPlan(JSON.parse(JSON.stringify(plan)))));

    expectFileBytes(root, receiptFile, changedReceiptBytes);
  });

  it("guards unchanged owned targets before committing another file", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const stableFile = createSettingsFile("stable.txt");
    const changedFile = createSettingsFile("changed.txt");
    const plan = checkPlan({
      scope: "project",
      root,
      operations: [{ _tag: "write", file: changedFile, bytes: installedBytes, expectedCurrent: expectedMissing }],
      preconditions: [{ path: stableFile.path, expectedCurrent: createExpectedFile(originalBytes) }],
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: createReceipt([stableFile, changedFile]),
        expectedCurrent: expectedMissing,
      },
    });
    seedFiles(root, { "stable.txt": externallyChangedBytes });

    await catchFailure(applyPlanUninterrupted(plan));

    expectFileBytes(root, "stable.txt", externallyChangedBytes);
    expectMissingPaths(root, ["changed.txt", receiptFile]);
  });

  it("refuses to start while durable recovery evidence is pending", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const pendingRecovery = new TextEncoder().encode("pending recovery");
    seedFiles(root, { [recoveryFile]: pendingRecovery });

    await catchFailure(
      applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["config/settings.json"]) })),
    );

    expectMissingPaths(root, ["config/settings.json"]);
    expectFileBytes(root, recoveryFile, pendingRecovery);
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it("rejects a symlinked parent before creating transaction state", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const outside = createTemporaryDirectory("agent-setup-apply-outside-");
    symlinkSync(outside, join(root, "link"));

    await catchFailure(
      applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["link/escaped.json"]) })),
    );

    expect(existsSync(join(outside, "escaped.json"))).toBe(false);
    expectMissingPaths(root, [receiptFile]);
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it("applies write, restore, and remove operations before publishing ownership", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const writtenFile = createSettingsFile("write.txt");
    const plan = checkPlan({
      scope: "project",
      root,
      operations: [
        { _tag: "write", file: writtenFile, bytes: installedBytes, expectedCurrent: expectedMissing },
        {
          _tag: "restore",
          file: createSettingsFile("restore.txt", { _tag: "priorFile", bytes: originalBytes }),
          bytes: originalBytes,
          expectedCurrent: createExpectedFile(installedBytes),
        },
        {
          _tag: "remove",
          file: createSettingsFile("remove.txt"),
          unownedBytes: new Uint8Array(),
          expectedCurrent: createExpectedFile(installedBytes),
        },
      ],
      preconditions: [],
      receipt: {
        _tag: "receiptPublish",
        target: receiptTarget,
        receipt: createReceipt([writtenFile]),
        expectedCurrent: expectedMissing,
      },
    });
    seedFiles(root, { "restore.txt": installedBytes, "remove.txt": installedBytes });

    await applyPlanUninterrupted(plan);

    expectFileBytes(root, "write.txt", installedBytes);
    expectFileBytes(root, "restore.txt", originalBytes);
    expectMissingPaths(root, ["remove.txt"]);
    expect(readPublishedReceipt(root).ownedFiles.map((file) => file.path)).toEqual(["write.txt"]);
  });

  it("removes the ownership receipt for a completed uninstall plan", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const previousReceiptBytes = new TextEncoder().encode("previous receipt");
    seedFiles(root, { [receiptFile]: previousReceiptBytes });

    await applyPlanUninterrupted(createReceiptRemovalPlan(root, createExpectedFile(previousReceiptBytes)));

    expectMissingPaths(root, [receiptFile]);
  });
});

describe("applyPlan under injected filesystem faults", () => {
  it.each([
    { name: "between atomic file commits", pausedAt: "first.txt", targets: ["first.txt", "second.txt"] },
    { name: "inside the atomic receipt commit", pausedAt: "receipt.json", targets: ["settings.json"] },
  ])("rolls back when interrupted $name", async ({ pausedAt, targets }) => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const pausedAfterRename = createGate();
    const releasePausedRename = createGate();
    injected.aroundCall = async (method, argumentList, run) => {
      const isPausedRename = method === "rename" && readFileName(argumentList[1]) === pausedAt;
      if (isPausedRename) {
        const renameReply = await run();
        pausedAfterRename.open();
        await releasePausedRename.wait;

        return renameReply;
      }

      return run();
    };
    const interruption = new AbortController();

    const failureAwaited = catchFailure(
      applyPlan(createWritePlan(root, { files: createMissingFiles(targets) }), interruption.signal),
    );
    await pausedAfterRename.wait;
    interruption.abort();
    releasePausedRename.open();
    const failure = await failureAwaited;

    expect(failure).toBe(interruption.signal.reason);
    expectMissingPaths(root, [...targets, receiptFile, recoveryFile]);
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it("commits the ownership receipt after every file", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    saveTransactionOrder();

    await applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["first.txt", "second.txt"]) }));

    expect(readTransactionOrder(root)).toEqual(["commit:first.txt", "commit:second.txt", "commit:receipt.json"]);
  });

  it("restores captured targets in reverse mutation order", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const seeded = { "first.txt": originalBytes, "second.txt": secondOriginalBytes, "fail.txt": originalBytes };
    seedFiles(root, seeded);
    const files = Object.fromEntries(
      Object.entries(seeded).map(([relative, bytes]) => [relative, createExpectedFile(bytes)]),
    );
    saveTransactionOrder();

    await catchFailure(applyPlanUninterrupted(createWritePlan(root, { files })));

    expect(readTransactionOrder(root)).toEqual([
      "commit:first.txt",
      "commit:second.txt",
      "restore:fail.txt",
      "restore:second.txt",
      "restore:first.txt",
    ]);
  });

  it("rejects a parent swapped to an outside symlink before commit", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const outside = `${root}-outside`;
    mkdirSync(join(root, "safe"));
    mkdirSync(outside);
    temporaryDirectories.push(outside);
    createRaceAfterReceiptPrepared((raceRoot) => {
      renameSync(join(raceRoot, "safe"), join(raceRoot, "safe-before-swap"));
      symlinkSync(`${raceRoot}-outside`, join(raceRoot, "safe"));
    });

    await catchFailure(
      applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["first.txt", "safe/escaped.json"]) })),
    );

    expectMissingPaths(root, ["first.txt", receiptFile]);
    expect(existsSync(join(outside, "escaped.json"))).toBe(false);
  });

  it("never publishes the recovery marker through a swapped parent", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const outside = `${root}-recovery-outside`;
    mkdirSync(join(root, ".agent-setup"));
    mkdirSync(outside);
    temporaryDirectories.push(outside);
    createRaceAfterReceiptPrepared((raceRoot) => {
      renameSync(join(raceRoot, ".agent-setup"), join(raceRoot, ".agent-setup-before-swap"));
      symlinkSync(`${raceRoot}-recovery-outside`, join(raceRoot, ".agent-setup"));
    });

    await catchFailure(applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["settings.json"]) })));

    expectMissingPaths(root, ["settings.json"]);
    expect(existsSync(join(outside, "recovery.json"))).toBe(false);
    expect(existsSync(join(outside, "receipt.json"))).toBe(false);
  });

  it.each([
    {
      name: "fails",
      failsMarkerLink: false,
      cause: "Injected link failure",
    },
    {
      name: "throws after linking",
      failsMarkerLink: true,
      cause: "Injected post-link defect",
    },
  ])(
    "cleans up without mutating destinations when recovery marker publication $name",
    async ({ failsMarkerLink, cause }) => {
      const root = createTemporaryDirectory("agent-setup-apply-");
      injected.aroundCall = async (method, callArguments, run) => {
        const isMarkerLink = method === "link" && readFileName(callArguments[1]) === "recovery.json";

        const isMarkerLinkThatThrowsAfterLinking = isMarkerLink && failsMarkerLink;
        if (isMarkerLinkThatThrowsAfterLinking) {
          await run();
          throw new Error("Injected post-link defect.");
        }

        if (isMarkerLink) {
          throw createInjectedFailure("link");
        }

        return run();
      };

      const failure = await catchFailure(
        applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["settings.json"]) })),
      );

      expect(describeFailure(failure)).toContain(cause);
      expectMissingPaths(root, ["settings.json", receiptFile, recoveryFile]);
      expect(listTransactionDirectories(root)).toEqual([]);
    },
  );

  it("removes the losing transaction without touching the winning marker", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const plan = createWritePlan(root, { files: { "settings.json": createExpectedFile(originalBytes) } });
    mkdirSync(join(root, ".agent-setup"));
    seedFiles(root, { "settings.json": originalBytes });
    const bothWritersArrived = createGate();
    const releaseWinner = createGate();
    const markerLinkArrivals = { count: 0 };
    // Both writers reach the marker link together; the winner then holds the marker until released.
    const createStopAtMarkerLink = async (): Promise<void> => {
      markerLinkArrivals.count += 1;

      const isSecondArrival = markerLinkArrivals.count === 2;
      if (isSecondArrival) {
        bothWritersArrived.open();
      }

      await bothWritersArrived.wait;
    };

    injected.aroundCall = async (method, callArguments, run) => {
      const isMarkerLink = method === "link" && readFileName(callArguments[1]) === "recovery.json";
      if (isMarkerLink) {
        await createStopAtMarkerLink();
        const linkReply = await run();
        await releaseWinner.wait;

        return linkReply;
      }

      return run();
    };

    const firstWriter = settleOperation(applyPlanUninterrupted(plan));
    const secondWriter = settleOperation(applyPlanUninterrupted(plan));
    try {
      const firstFinished = await Promise.race([firstWriter, secondWriter]);

      expect(firstFinished._tag).toBe("rejected");
      expect(existsSync(join(root, recoveryFile))).toBe(true);
      expect(listTransactionDirectories(root)).toHaveLength(1);
    } finally {
      releaseWinner.open();
    }

    const writerVerdicts = await Promise.all([firstWriter, secondWriter]);

    expect(writerVerdicts.filter((verdict) => verdict._tag === "fulfilled")).toHaveLength(1);
    expect(writerVerdicts.filter((writerVerdict) => writerVerdict._tag === "rejected")).toHaveLength(1);
    expectFileBytes(root, "settings.json", installedBytes);
    expect(readPublishedReceipt(root)).toEqual(plan.receipt.receipt);
    expectMissingPaths(root, [recoveryFile]);
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it("preserves bytes changed after capture instead of overwriting them", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    seedFiles(root, { "changed.txt": originalBytes });
    createRaceAfterReceiptPrepared((raceRoot) => {
      writeFileSync(join(raceRoot, "changed.txt"), externallyChangedBytes);
    });

    await catchFailure(
      applyPlanUninterrupted(
        createWritePlan(root, {
          files: { "first.txt": expectedMissing, "changed.txt": createExpectedFile(originalBytes) },
        }),
      ),
    );

    expectMissingPaths(root, ["first.txt", receiptFile]);
    expectFileBytes(root, "changed.txt", externallyChangedBytes);
  });

  it("restores original bytes and removes created parents after a middle commit failure", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    seedFiles(root, { "existing.txt": originalBytes });
    const files = {
      "existing.txt": createExpectedFile(originalBytes),
      "created/nested/file.txt": expectedMissing,
      "fail.txt": expectedMissing,
    };
    failCommitOfFailFile();

    await catchFailure(applyPlanUninterrupted(createWritePlan(root, { files })));

    expectFileBytes(root, "existing.txt", originalBytes);
    expectMissingPaths(root, ["created", "fail.txt", receiptFile]);
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it("removes snapshots while preserving external content in a created parent", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    failCommitOfFailFile((failureRoot) => {
      writeFileSync(join(failureRoot, "created/nested/external.txt"), externallyChangedBytes);
    });

    await catchFailure(
      applyPlanUninterrupted(
        createWritePlan(root, { files: createMissingFiles(["created/nested/file.txt", "fail.txt"]) }),
      ),
    );

    expectFileBytes(root, "created/nested/external.txt", externallyChangedBytes);
    expectMissingPaths(root, [receiptFile, recoveryFile]);
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it("retains recovery state instead of overwriting bytes changed after commit", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    failCommitOfFailFile((failureRoot) => {
      writeFileSync(join(failureRoot, "first.txt"), externallyChangedBytes);
    });

    await catchFailure(
      applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["first.txt", "fail.txt"]) })),
    );

    expectFileBytes(root, "first.txt", externallyChangedBytes);
    expectMissingPaths(root, [receiptFile]);
    expect(existsSync(readRecovery(root).transactionRoot)).toBe(true);
  });

  it("rolls files back and restores the prior receipt bytes after the receipt commit fails", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    const priorReceiptBytes = new Uint8Array([255, 0, 1, 128]);
    seedFiles(root, { "existing.txt": originalBytes, [receiptFile]: priorReceiptBytes });
    failCallsWhen((method, callArguments) => method === "rename" && readFileName(callArguments[1]) === "receipt.json");

    const failure = await catchFailure(
      applyPlanUninterrupted(
        createWritePlan(root, {
          files: { "existing.txt": createExpectedFile(originalBytes) },
          receipt: createExpectedFile(priorReceiptBytes),
        }),
      ),
    );

    expect(describeFailure(failure)).toContain("Injected rename failure");
    expectFileBytes(root, "existing.txt", originalBytes);
    expectFileBytes(root, receiptFile, priorReceiptBytes);
    expect(listTransactionDirectories(root)).toEqual([]);
  });

  it.each([
    {
      name: "preparing",
      failed: "second.txt",
      isFailingCall: (method: string, callArguments: ReadonlyArray<unknown>) =>
        method === "writeFile" && createForwardSlashPath(String(callArguments[0])).includes("/prepared/1"),
    },
    {
      name: "capturing a snapshot",
      failed: "snapshot-fail.txt",
      isFailingCall: (method: string, callArguments: ReadonlyArray<unknown>) =>
        method === "readFile" && readFileName(callArguments[0]) === "snapshot-fail.txt",
    },
  ])(
    "leaves every destination unchanged and removes transaction state when $name fails",
    async ({ failed, isFailingCall }) => {
      const root = createTemporaryDirectory("agent-setup-apply-");
      seedFiles(root, { "first.txt": originalBytes, [failed]: secondOriginalBytes });
      const files = {
        "first.txt": createExpectedFile(originalBytes),
        [failed]: createExpectedFile(secondOriginalBytes),
      };
      failCallsWhen(isFailingCall);

      await catchFailure(applyPlanUninterrupted(createWritePlan(root, { files })));

      expectFileBytes(root, "first.txt", originalBytes);
      expect(statSync(join(root, failed)).isFile()).toBe(true);
      expectMissingPaths(root, [receiptFile]);
      expect(listTransactionDirectories(root)).toEqual([]);
    },
  );

  it("surfaces cleanup failure without rolling back the committed receipt", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    failCallsWhen(
      (method, callArguments) =>
        method === "rm" && createForwardSlashPath(String(callArguments[0])).includes("/.agent-setup-transaction-"),
    );

    await catchFailure(applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["settings.json"]) })));

    expectFileBytes(root, "settings.json", installedBytes);
    expect(existsSync(join(root, receiptFile))).toBe(true);
    expectMissingPaths(root, [recoveryFile]);
    expect(listTransactionDirectories(root)).toHaveLength(1);
  });

  it("retains the recovery marker and snapshots after committed cleanup fails", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    failCallsWhen((method, callArguments) => method === "rm" && readFileName(callArguments[0]) === "recovery.json");

    await catchFailure(applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["settings.json"]) })));

    expectFileBytes(root, "settings.json", installedBytes);
    expect(existsSync(join(root, receiptFile))).toBe(true);
    expect(existsSync(readRecovery(root).transactionRoot)).toBe(true);
  });

  it("never unlinks a marker that changed before committed cleanup", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    injected.aroundCall = async (method, callArguments, run) => {
      const callReply = await run();

      const isReceiptCommit = method === "rename" && readFileName(callArguments[1]) === "receipt.json";
      if (isReceiptCommit) {
        writeFileSync(join(dirname(String(callArguments[1])), "recovery.json"), "changed marker");
      }

      return callReply;
    };

    await catchFailure(applyPlanUninterrupted(createWritePlan(root, { files: createMissingFiles(["settings.json"]) })));

    expect(existsSync(join(root, receiptFile))).toBe(true);
    expect(readFileSync(join(root, recoveryFile), "utf8")).toBe("changed marker");
    expect(listTransactionDirectories(root)).toHaveLength(1);
  });

  it("retains snapshots and writes strict durable recovery evidence when rollback fails", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    seedFiles(root, { "existing.txt": originalBytes });
    failRollbackOfExistingFile();

    const failure = await catchFailure(applyPlanUninterrupted(createFailedRollbackPlan(root)));

    const failureString = describeFailure(failure);
    expect(failureString).toContain("Injected rename failure");
    expect(failureString).toContain("Injected copyFile failure");
    expectMissingPaths(root, ["existing.txt", receiptFile]);

    const recovery = readRecovery(root);
    const canonicalRoot = realpathSync(root);
    const canonicalOriginalPath = join(canonicalRoot, "existing.txt");
    expect(recovery._tag).toBe("pending");
    expect(recovery.root).toBe(canonicalRoot);
    expect(recovery.receiptPath).toBe(join(canonicalRoot, receiptFile));
    expect(existsSync(recovery.transactionRoot)).toBe(true);
    expect(existsSync(join(recovery.transactionRoot, "prepared"))).toBe(false);

    const snapshot = recovery.snapshots.find((candidate) => candidate.targetPath === canonicalOriginalPath);
    const snapshotOriginal = snapshot?.original;
    const isFileSnapshot = snapshotOriginal?._tag === "file";
    expect(snapshotOriginal?._tag).toBe("file");

    if (isFileSnapshot) {
      expect([...readFileSync(snapshotOriginal.snapshotPath)]).toEqual([...originalBytes]);
    }
  });

  it.skipIf(process.platform === "win32")("keeps retained recovery state private on POSIX hosts", async () => {
    const root = createTemporaryDirectory("agent-setup-apply-");
    writeFileSync(join(root, "existing.txt"), originalBytes, { mode: 0o600 });
    failRollbackOfExistingFile();

    await settleOperation(applyPlanUninterrupted(createFailedRollbackPlan(root)));

    const recovery = readRecovery(root);
    const snapshot = recovery.snapshots.find((candidate) => candidate.targetPath.endsWith("/existing.txt"));
    const readFileMode = (filePath: string): number => statSync(filePath).mode & 0o777;
    expect(readFileMode(recovery.transactionRoot)).toBe(0o700);
    expect(readFileMode(join(recovery.transactionRoot, "pending.json"))).toBe(0o600);
    const snapshotOriginal = snapshot?.original;
    const isFileSnapshot = snapshotOriginal?._tag === "file";
    expect(snapshotOriginal?._tag).toBe("file");

    if (isFileSnapshot) {
      expect(readFileMode(snapshotOriginal.snapshotPath)).toBe(0o600);
    }
  });
});
