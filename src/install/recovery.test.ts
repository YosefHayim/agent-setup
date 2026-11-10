import { describe, expect, it } from "vitest";

import { decodeRecoveryDocument } from "./recovery.js";

const transactionName = ".agent-setup-transaction-00000000-0000-4000-8000-000000000000";
const transactionRoot = `/safe/${transactionName}`;

const createMissingAt = (targetPath: string) => ({ targetPath, original: { _tag: "missing" } });

const snapshotAt = (targetPath: string, snapshotPath: string) => ({
  targetPath,
  original: { _tag: "file", snapshotPath },
});

const receiptSnapshot = createMissingAt("/safe/.agent-setup/receipt.json");
const storedValid = {
  _tag: "pending",
  version: 1,
  root: "/safe",
  receiptPath: "/safe/.agent-setup/receipt.json",
  transactionRoot,
  snapshots: [receiptSnapshot],
};

// Extra snapshots are checked alongside the receipt snapshot every valid record needs.
const attachSnapshots = (snapshots: ReadonlyArray<object>) => ({
  ...storedValid,
  snapshots: [...snapshots, receiptSnapshot],
});

const createDrivePath = (fields: object) => ({
  ...storedValid,
  root: "C:/safe",
  receiptPath: "C:/safe/.agent-setup/receipt.json",
  transactionRoot: `C:/safe/${transactionName}`,
  snapshots: [createMissingAt("C:/safe/.agent-setup/receipt.json")],
  ...fields,
});

describe("recovery", () => {
  it("decodes strict contained recovery records", () => {
    const storedRoot = {
      ...storedValid,
      root: "/",
      receiptPath: "/.agent-setup/receipt.json",
      transactionRoot: `/${transactionName}`,
      snapshots: [createMissingAt("/.agent-setup/receipt.json")],
    };

    expect(decodeRecoveryDocument(JSON.stringify(storedValid))).toEqual(storedValid);
    expect(decodeRecoveryDocument(JSON.stringify(storedRoot)).root).toBe("/");
  });

  // Every malformed record must fail before recovery can touch the filesystem.
  it.each([
    { name: "embedded NUL", record: attachSnapshots([createMissingAt("/safe/file\0.txt")]) },
    { name: "recovery marker target", record: attachSnapshots([createMissingAt("/safe/.agent-setup/recovery.json")]) },
    {
      name: "recovery marker descendant",
      record: attachSnapshots([createMissingAt("/safe/.agent-setup/recovery.json/child")]),
    },
    { name: "root target", record: attachSnapshots([createMissingAt("/safe")]) },
    { name: "transaction target", record: attachSnapshots([createMissingAt(`${transactionRoot}/snapshots/evidence`)]) },
    { name: "ancestor targets", record: attachSnapshots([createMissingAt("/safe/a"), createMissingAt("/safe/a/b")]) },
    {
      name: "case-fold target aliases",
      record: attachSnapshots([createMissingAt("/safe/A"), createMissingAt("/safe/a")]),
    },
    {
      name: "duplicate snapshot source",
      record: attachSnapshots([
        snapshotAt("/safe/a", `${transactionRoot}/snapshots/0`),
        snapshotAt("/safe/b", `${transactionRoot}/snapshots/0`),
      ]),
    },
    {
      name: "case-fold snapshot aliases",
      record: attachSnapshots([
        snapshotAt("/safe/a", `${transactionRoot}/snapshots/A`),
        snapshotAt("/safe/b", `${transactionRoot}/snapshots/a`),
      ]),
    },
    {
      name: "nested snapshot source",
      record: attachSnapshots([snapshotAt("/safe/a", `${transactionRoot}/snapshots/nested/0`)]),
    },
    {
      name: "prepared snapshot source",
      record: attachSnapshots([snapshotAt("/safe/a", `${transactionRoot}/prepared/0`)]),
    },
    {
      name: "malformed transaction suffix",
      record: { ...storedValid, transactionRoot: "/safe/.agent-setup-transaction-invalid" },
    },
    {
      name: "uppercase transaction path",
      record: { ...storedValid, transactionRoot: `/safe/${transactionName.toUpperCase()}` },
    },
    {
      name: "drive-qualified uppercase transaction path",
      record: createDrivePath({ transactionRoot: `C:/safe/${transactionName.toUpperCase()}` }),
    },
    {
      name: "case-only receipt target",
      record: { ...storedValid, snapshots: [createMissingAt("/safe/.AGENT-SETUP/RECEIPT.JSON")] },
    },
    {
      name: "drive-qualified case-only receipt target",
      record: createDrivePath({ snapshots: [createMissingAt("C:/safe/.AGENT-SETUP/RECEIPT.JSON")] }),
    },
    {
      name: "drive-qualified case-only snapshot parent",
      record: createDrivePath({
        snapshots: [
          snapshotAt("C:/safe/a", `C:/safe/${transactionName.toUpperCase()}/SNAPSHOTS/0`),
          createMissingAt("C:/safe/.agent-setup/receipt.json"),
        ],
      }),
    },
    {
      name: "drive-qualified case-only root alias",
      record: createDrivePath({
        snapshots: [createMissingAt("C:/SAFE/file.txt"), createMissingAt("C:/safe/.agent-setup/receipt.json")],
      }),
    },
    { name: "target outside root", record: attachSnapshots([createMissingAt("/outside.txt")]) },
    { name: "relative root", record: { ...storedValid, root: "relative" } },
    { name: "unknown property", record: { ...storedValid, unexpected: true } },
    { name: "POSIX backslash target", record: attachSnapshots([createMissingAt("/safe\\outside/victim")]) },
    {
      name: "POSIX backslash snapshot",
      record: attachSnapshots([snapshotAt("/safe/a", `${transactionRoot}/snapshots\\0`)]),
    },
  ])("rejects an ambiguous or self-destructive record: $name", ({ record: stored }) => {
    expect(() => decodeRecoveryDocument(JSON.stringify(stored))).toThrow();
  });
});
