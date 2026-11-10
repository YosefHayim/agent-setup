import { describe, expect, it } from "vitest";

import { decodeRecoveryRecordJson } from "./recovery.js";

const transactionName = ".agent-setup-transaction-00000000-0000-4000-8000-000000000000";
const transactionRoot = `/safe/${transactionName}`;

const missingAt = (targetPath: string) => ({ targetPath, original: { _tag: "missing" } });

const snapshotAt = (targetPath: string, snapshotPath: string) => ({
  targetPath,
  original: { _tag: "file", snapshotPath },
});

const receiptSnapshot = missingAt("/safe/.agent-setup/receipt.json");
const validRecord = {
  _tag: "pending",
  version: 1,
  root: "/safe",
  receiptPath: "/safe/.agent-setup/receipt.json",
  transactionRoot,
  snapshots: [receiptSnapshot],
};

// Extra snapshots are checked alongside the receipt snapshot every valid record needs.
const withSnapshots = (snapshots: ReadonlyArray<object>) => ({
  ...validRecord,
  snapshots: [...snapshots, receiptSnapshot],
});

const driveRecord = (fields: object) => ({
  ...validRecord,
  root: "C:/safe",
  receiptPath: "C:/safe/.agent-setup/receipt.json",
  transactionRoot: `C:/safe/${transactionName}`,
  snapshots: [missingAt("C:/safe/.agent-setup/receipt.json")],
  ...fields,
});

describe("recovery", () => {
  it("decodes strict contained recovery records", () => {
    const rootRecord = {
      ...validRecord,
      root: "/",
      receiptPath: "/.agent-setup/receipt.json",
      transactionRoot: `/${transactionName}`,
      snapshots: [missingAt("/.agent-setup/receipt.json")],
    };

    expect(decodeRecoveryRecordJson(JSON.stringify(validRecord))).toEqual(validRecord);
    expect(decodeRecoveryRecordJson(JSON.stringify(rootRecord)).root).toBe("/");
  });

  // Every malformed record must fail before recovery can touch the filesystem.
  it.each([
    { name: "embedded NUL", record: withSnapshots([missingAt("/safe/file\0.txt")]) },
    { name: "recovery marker target", record: withSnapshots([missingAt("/safe/.agent-setup/recovery.json")]) },
    {
      name: "recovery marker descendant",
      record: withSnapshots([missingAt("/safe/.agent-setup/recovery.json/child")]),
    },
    { name: "root target", record: withSnapshots([missingAt("/safe")]) },
    { name: "transaction target", record: withSnapshots([missingAt(`${transactionRoot}/snapshots/evidence`)]) },
    { name: "ancestor targets", record: withSnapshots([missingAt("/safe/a"), missingAt("/safe/a/b")]) },
    { name: "case-fold target aliases", record: withSnapshots([missingAt("/safe/A"), missingAt("/safe/a")]) },
    {
      name: "duplicate snapshot source",
      record: withSnapshots([
        snapshotAt("/safe/a", `${transactionRoot}/snapshots/0`),
        snapshotAt("/safe/b", `${transactionRoot}/snapshots/0`),
      ]),
    },
    {
      name: "case-fold snapshot aliases",
      record: withSnapshots([
        snapshotAt("/safe/a", `${transactionRoot}/snapshots/A`),
        snapshotAt("/safe/b", `${transactionRoot}/snapshots/a`),
      ]),
    },
    {
      name: "nested snapshot source",
      record: withSnapshots([snapshotAt("/safe/a", `${transactionRoot}/snapshots/nested/0`)]),
    },
    {
      name: "prepared snapshot source",
      record: withSnapshots([snapshotAt("/safe/a", `${transactionRoot}/prepared/0`)]),
    },
    {
      name: "malformed transaction suffix",
      record: { ...validRecord, transactionRoot: "/safe/.agent-setup-transaction-invalid" },
    },
    {
      name: "uppercase transaction path",
      record: { ...validRecord, transactionRoot: `/safe/${transactionName.toUpperCase()}` },
    },
    {
      name: "drive-qualified uppercase transaction path",
      record: driveRecord({ transactionRoot: `C:/safe/${transactionName.toUpperCase()}` }),
    },
    {
      name: "case-only receipt target",
      record: { ...validRecord, snapshots: [missingAt("/safe/.AGENT-SETUP/RECEIPT.JSON")] },
    },
    {
      name: "drive-qualified case-only receipt target",
      record: driveRecord({ snapshots: [missingAt("C:/safe/.AGENT-SETUP/RECEIPT.JSON")] }),
    },
    {
      name: "drive-qualified case-only snapshot parent",
      record: driveRecord({
        snapshots: [
          snapshotAt("C:/safe/a", `C:/safe/${transactionName.toUpperCase()}/SNAPSHOTS/0`),
          missingAt("C:/safe/.agent-setup/receipt.json"),
        ],
      }),
    },
    {
      name: "drive-qualified case-only root alias",
      record: driveRecord({
        snapshots: [missingAt("C:/SAFE/file.txt"), missingAt("C:/safe/.agent-setup/receipt.json")],
      }),
    },
    { name: "target outside root", record: withSnapshots([missingAt("/outside.txt")]) },
    { name: "relative root", record: { ...validRecord, root: "relative" } },
    { name: "unknown property", record: { ...validRecord, unexpected: true } },
    { name: "POSIX backslash target", record: withSnapshots([missingAt("/safe\\outside/victim")]) },
    {
      name: "POSIX backslash snapshot",
      record: withSnapshots([snapshotAt("/safe/a", `${transactionRoot}/snapshots\\0`)]),
    },
  ])("rejects an ambiguous or self-destructive record: $name", ({ record }) => {
    expect(() => decodeRecoveryRecordJson(JSON.stringify(record))).toThrow();
  });
});
