import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import {
  documentFieldsOwnershipSchema,
  documentPointerSchema,
  fileKindSchema,
  fileOwnerSchema,
  hookEntriesOwnershipSchema,
  managedBlockOwnershipSchema,
  type OwnedFile,
  ownedFileSchema,
  previousDocumentFieldSchema,
  previousFileFieldSchema,
  relativePathSchema,
  sha256Schema,
  yamlSequenceFieldOwnershipSchema,
} from "./ownership.js";
import { decodeReceiptDocument, encodeReceiptDocument, type Receipt, readReceipt, receiptSchema } from "./receipt.js";

const installedHash = "a".repeat(64);
const installedFieldHash = "b".repeat(64);
const stringEncoder = new TextEncoder();

const temporaryRoots: Array<string> = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const makeTemporaryRoot = (prefix: string): string => {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);

  return root;
};

const writeReceiptFile = (bytes: Uint8Array): string => {
  const receiptFilePath = path.join(makeTemporaryRoot("agent-setup-receipt-"), "receipt.json");
  writeFileSync(receiptFilePath, bytes);

  return receiptFilePath;
};

const missingPrevious = { _tag: "missing" };
const applicationOwner = { _tag: "application" };
const agentOwner = { _tag: "agent", agentIds: ["codex"] };
const sharedAgentOwner = { _tag: "agent", agentIds: ["codex", "aider"] };

const wholeFileOwnership = { _tag: "wholeFile", installedHash, previous: missingPrevious };

const managedBlockOwnership = {
  _tag: "managedBlock",
  filePreviouslyPresent: true,
  startMarker: "<!-- agent-setup:skills start -->",
  endMarker: "<!-- agent-setup:skills end -->",
  installedBodyHash: installedHash,
};

const createOwnedField = (pointer: string, previous: object = missingPrevious) => ({
  pointer,
  installed: { _tag: "value", hash: installedFieldHash },
  previous,
});

const createDocumentFields = (fields: ReadonlyArray<object>, createdContainers: ReadonlyArray<string> = []) => ({
  _tag: "jsonValues",
  filePreviouslyPresent: true,
  createdContainers,
  values: fields,
});

const documentFieldsOwnership = createDocumentFields([
  createOwnedField("/hooks/PreToolUse"),
  { pointer: "/enabled", installed: { _tag: "value", hash: installedHash }, previous: { _tag: "value", value: false } },
]);

const settingsDocumentFieldsOwnership = createDocumentFields([
  createOwnedField("/hooks/PreToolUse"),
  {
    pointer: "/enabled",
    installed: { _tag: "value", hash: installedHash },
    previous: { _tag: "value", value: false, lexical: { _tag: "value", source: "false" } },
  },
]);

const createHookEntries = (
  events: ReadonlyArray<{ pointer: string; entries: ReadonlyArray<string> }>,
  createdContainers: ReadonlyArray<string> = [],
) => ({
  _tag: "hookEntries",
  filePreviouslyPresent: true,
  createdContainers,
  events: events.map((event) => ({ ...event, previouslyPresent: false })),
});

const yamlSequenceOwnership = {
  _tag: "yamlSequenceValue",
  filePreviouslyPresent: true,
  key: "read",
  keyPreviouslyPresent: true,
  insertedPrefix: "",
  reference: "AGENTS.md",
  previouslyPresent: false,
};

const createOwnedFile = (kind: string, file: { owner: object; path: string; ownership: object }) => ({
  ...file,
  kind: { _tag: kind },
});

const completeReceiptFields = {
  version: "1.0.0",
  scope: "project",
  features: ["scratch-folder-guard", "make-code-readable"],
  ownedFiles: [
    createOwnedFile("runtime", {
      owner: applicationOwner,
      path: ".claude/agent-setup/hooks/scratch-folder-guard/hooks/scratch-folder-guard.js",
      ownership: { ...wholeFileOwnership, previous: { _tag: "priorFile", bytes: "AQID" } },
    }),
    createOwnedFile("skill", {
      owner: agentOwner,
      path: ".claude/skills/make-code-readable/SKILL.md",
      ownership: wholeFileOwnership,
    }),
    createOwnedFile("rule", {
      owner: agentOwner,
      path: ".cursor/rules/make-code-readable.mdc",
      ownership: wholeFileOwnership,
    }),
    createOwnedFile("instruction", { owner: sharedAgentOwner, path: "AGENTS.md", ownership: managedBlockOwnership }),
    createOwnedFile("instructionLink", {
      owner: agentOwner,
      path: ".continue/config.json",
      ownership: documentFieldsOwnership,
    }),
    createOwnedFile("instructionLink", {
      owner: agentOwner,
      path: ".aider.conf.yml",
      ownership: yamlSequenceOwnership,
    }),
    createOwnedFile("settings", {
      owner: applicationOwner,
      path: ".claude/settings.json",
      ownership: settingsDocumentFieldsOwnership,
    }),
    createOwnedFile("managedConfig", {
      owner: applicationOwner,
      path: ".claude/agent-setup/config.json",
      ownership: wholeFileOwnership,
    }),
  ],
};

const createStrictDecoder =
  <Printout>(zodSchema: z.ZodType<Printout>) =>
  (uncheckedReceipt: unknown): Printout =>
    zodSchema.parse(uncheckedReceipt);

const decodeReceipt = createStrictDecoder(receiptSchema);
const decodeOwnedFile = createStrictDecoder(ownedFileSchema);
const decodeOwner = createStrictDecoder(fileOwnerSchema);
const decodeKind = createStrictDecoder(fileKindSchema);
const decodePreviousFile = createStrictDecoder(previousFileFieldSchema);
const decodePreviousDocument = createStrictDecoder(previousDocumentFieldSchema);
const decodeDocumentFields = createStrictDecoder(documentFieldsOwnershipSchema);
const decodeYamlSequenceField = createStrictDecoder(yamlSequenceFieldOwnershipSchema);
const decodeHookEntries = createStrictDecoder(hookEntriesOwnershipSchema);

const completeReceipt = decodeReceipt(completeReceiptFields);
const completeReceiptDocument = encodeReceiptDocument(completeReceipt);

const createReceiptWithFiles = (files: ReadonlyArray<unknown>) => ({
  version: "1.0.0",
  scope: "project",
  features: ["scratch-folder-guard"],
  ownedFiles: files,
});

const readAfterWrite = (files: ReadonlyArray<unknown>) =>
  decodeReceiptDocument(encodeReceiptDocument(decodeReceipt(createReceiptWithFiles(files))));

describe("receiptSchema", () => {
  it("decodes every receiptable file kind and all ownership tags", () => {
    expect(completeReceipt.ownedFiles.map((file) => file.kind._tag)).toEqual([
      "runtime",
      "skill",
      "rule",
      "instruction",
      "instructionLink",
      "instructionLink",
      "settings",
      "managedConfig",
    ]);
    expect(completeReceipt.ownedFiles.map((file) => file.ownership._tag)).toEqual([
      "wholeFile",
      "wholeFile",
      "wholeFile",
      "managedBlock",
      "jsonValues",
      "yamlSequenceValue",
      "jsonValues",
      "wholeFile",
    ]);
    expect(completeReceipt.ownedFiles[0]?.ownership).toMatchObject({
      _tag: "wholeFile",
      previous: { _tag: "priorFile", bytes: new Uint8Array([1, 2, 3]) },
    });
    expectTypeOf(completeReceipt).toMatchTypeOf<Receipt>();
    expectTypeOf(completeReceipt.ownedFiles).items.toMatchTypeOf<OwnedFile>();
  });

  it("decodes all eight tagged file kinds while preventing receipt self-ownership", () => {
    const kindTags = [
      "runtime",
      "skill",
      "rule",
      "instruction",
      "instructionLink",
      "settings",
      "managedConfig",
      "receipt",
    ];
    const receiptOwnedFile = createOwnedFile("receipt", {
      owner: applicationOwner,
      path: ".claude/agent-setup/receipt.json",
      ownership: wholeFileOwnership,
    });

    expect(kindTags.map((_tag) => decodeKind({ _tag })._tag)).toEqual(kindTags);
    expect(decodeOwnedFile(receiptOwnedFile).kind._tag).toBe("receipt");
    expect(() => decodeReceipt(createReceiptWithFiles([receiptOwnedFile]))).toThrow(/itself|receipt/i);
  });

  it("round-trips every receipt field through the JSON codec", () => {
    const encoded = JSON.parse(completeReceiptDocument);

    expect(Object.keys(encoded)).toEqual(["version", "scope", "features", "ownedFiles"]);
    expect(encoded.ownedFiles[0].ownership.previous.bytes).toBe("AQID");
    expect(decodeReceiptDocument(completeReceiptDocument)).toEqual(completeReceipt);
  });

  it("preserves host-file existence for member-level ownership through receipt JSON", () => {
    const receipt = readAfterWrite([
      createOwnedFile("instruction", { owner: sharedAgentOwner, path: "AGENTS.md", ownership: managedBlockOwnership }),
      createOwnedFile("instructionLink", {
        owner: agentOwner,
        path: ".continue/config.json",
        ownership: {
          ...documentFieldsOwnership,
          filePreviouslyPresent: false,
          values: documentFieldsOwnership.values.map((field) => ({ ...field, previous: missingPrevious })),
        },
      }),
      createOwnedFile("instructionLink", {
        owner: agentOwner,
        path: ".aider.conf.yml",
        ownership: yamlSequenceOwnership,
      }),
    ]);

    expect(receipt.ownedFiles.map((file) => file.ownership)).toMatchObject([
      { _tag: "managedBlock", filePreviouslyPresent: true },
      { _tag: "jsonValues", filePreviouslyPresent: false },
      { _tag: "yamlSequenceValue", filePreviouslyPresent: true },
    ]);
  });

  it("round-trips members acquired after a receipt first created their host files", () => {
    const receipt = readAfterWrite([
      createOwnedFile("instructionLink", {
        owner: agentOwner,
        path: ".continue/config.json",
        ownership: { ...documentFieldsOwnership, filePreviouslyPresent: false },
      }),
      createOwnedFile("instructionLink", {
        owner: agentOwner,
        path: ".aider.conf.yml",
        ownership: { ...yamlSequenceOwnership, filePreviouslyPresent: false, previouslyPresent: true },
      }),
    ]);

    expect(receipt.ownedFiles.map((file) => file.ownership)).toMatchObject([
      {
        _tag: "jsonValues",
        filePreviouslyPresent: false,
        values: [{ previous: { _tag: "missing" } }, { previous: { _tag: "value", value: false } }],
      },
      { _tag: "yamlSequenceValue", filePreviouslyPresent: false, previouslyPresent: true },
    ]);
  });

  it.each([
    { ...completeReceiptFields, unexpected: true },
    { ...completeReceiptFields, detectedAgents: ["codex"] },
  ])("rejects receipt-level excess or detection evidence", (invalidReceipt) => {
    expect(() => decodeReceipt(invalidReceipt)).toThrow();
    expect(() => decodeReceiptDocument(JSON.stringify(invalidReceipt))).toThrow();
  });

  it.each([
    { name: "owner", decode: () => decodeOwner({ _tag: "application", extra: true }) },
    { name: "kind", decode: () => decodeKind({ _tag: "runtime", extra: true }) },
    { name: "previous file", decode: () => decodePreviousFile({ _tag: "missing", extra: true }) },
    { name: "previous JSON field", decode: () => decodePreviousDocument({ _tag: "value", value: null, extra: true }) },
    { name: "owned file", decode: () => decodeOwnedFile({ ...completeReceiptFields.ownedFiles[0], extra: true }) },
    {
      name: "owned JSON field",
      decode: () => decodeDocumentFields(createDocumentFields([{ ...createOwnedField("/field"), extra: true }])),
    },
  ])("rejects excess properties on the $name boundary", ({ decode }) => {
    expect(decode).toThrow();
  });

  it.each([
    "/absolute",
    "../escape",
    "nested/../../escape",
    "nested//file",
    "C:/file",
    "C:foo",
    "nested\\file",
    ".",
    "nested/./file",
  ])("rejects unsafe file path %j", (path) => {
    expect(() => relativePathSchema.parse(path)).toThrow();
  });

  it.each([".claude/settings.json", "AGENTS.md"])("accepts normalized relative path %j", (path) => {
    expect(relativePathSchema.parse(path)).toBe(path);
  });

  it.each(["a".repeat(63), "A".repeat(64), `${"a".repeat(63)}g`, ""])("rejects invalid SHA-256 %j", (hash) => {
    expect(() => sha256Schema.parse(hash)).toThrow();
  });

  it("decodes canonical base64 prior file bytes", () => {
    expect(decodePreviousFile({ _tag: "priorFile", bytes: "Zg==" })).toEqual({
      _tag: "priorFile",
      bytes: new Uint8Array([102]),
    });
  });

  it.each(["Zg=", "Zh==", "AB==", "***"])("rejects non-canonical base64 prior file bytes %j", (bytes) => {
    expect(() => decodePreviousFile({ _tag: "priorFile", bytes })).toThrow();
  });

  it.each(["", "rules", "#/rules", "/bad~2escape", "/bad~escape"])("rejects invalid JSON pointer %j", (pointer) => {
    expect(() => documentPointerSchema.parse(pointer)).toThrow();
  });

  it.each(["/rules/0", "/a~1b/~0key"])("accepts escaped absolute JSON pointer %j", (pointer) => {
    expect(documentPointerSchema.parse(pointer)).toBe(pointer);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, new Date("2026-01-01T00:00:00.000Z")])(
    "rejects a non-JSON previous field",
    (field) => {
      expect(() => decodePreviousDocument({ _tag: "value", value: field })).toThrow();
    },
  );

  it.each([
    { name: "duplicate", pointers: ["/rules", "/rules"] },
    { name: "parent-child", pointers: ["/rules", "/rules/0"] },
  ])("rejects $name JSON pointers", ({ pointers }) => {
    expect(() =>
      decodeDocumentFields(createDocumentFields(pointers.map((pointer) => createOwnedField(pointer)))),
    ).toThrow(/pointer/i);
  });

  it("records hashed installed JSON states with exact created containers", () => {
    const ownership = decodeDocumentFields(createDocumentFields([createOwnedField("/hooks/PreToolUse")], ["/hooks"]));

    expect(ownership.createdContainers).toEqual(["/hooks"]);
    expect(ownership.values.map((field) => field.installed)).toEqual([{ _tag: "value", hash: installedFieldHash }]);
  });

  it.each([
    { name: "duplicate", createdContainers: ["/hooks", "/hooks"] },
    { name: "unrelated", createdContainers: ["/permissions"] },
    { name: "owned field itself", createdContainers: ["/hooks/Stop"] },
  ])("rejects $name created JSON containers", ({ createdContainers }) => {
    expect(() =>
      decodeDocumentFields(
        createDocumentFields([createOwnedField("/hooks/Stop", { _tag: "value", value: [] })], createdContainers),
      ),
    ).toThrow(/container|ancestor|unique/i);
  });

  it("records the hash of each owned hook entry per event with exact created containers", () => {
    const ownership = decodeHookEntries(
      createHookEntries([{ pointer: "/hooks/Stop", entries: [installedFieldHash, installedFieldHash] }], ["/hooks"]),
    );

    expect(ownership.createdContainers).toEqual(["/hooks"]);
    expect(ownership.events).toEqual([
      { pointer: "/hooks/Stop", previouslyPresent: false, entries: [installedFieldHash, installedFieldHash] },
    ]);
  });

  it.each([
    { name: "nested hook entry pointer", events: [{ pointer: "/hooks/Stop/0", entries: [installedFieldHash] }] },
    { name: "non-hook pointer", events: [{ pointer: "/permissions", entries: [installedFieldHash] }] },
    { name: "escaped event name", events: [{ pointer: "/hooks/foo~1bar", entries: [installedFieldHash] }] },
    { name: "event without entries", events: [{ pointer: "/hooks/Stop", entries: [] }] },
    { name: "missing events", events: [] },
    {
      name: "duplicate events",
      events: [
        { pointer: "/hooks/Stop", entries: [installedFieldHash] },
        { pointer: "/hooks/Stop", entries: [installedHash] },
      ],
    },
  ])("rejects hook entry ownership with a $name", ({ events }) => {
    expect(() => decodeHookEntries(createHookEntries(events))).toThrow();
  });

  it("rejects a hook entry created container that holds no owned event", () => {
    expect(() =>
      decodeHookEntries(
        createHookEntries([{ pointer: "/hooks/Stop", entries: [installedFieldHash] }], ["/permissions"]),
      ),
    ).toThrow(/container|ancestor/i);
  });

  it("allows missing owned members when the host file previously existed", () => {
    expect(decodeDocumentFields(createDocumentFields([createOwnedField("/rules")])).filePreviouslyPresent).toBe(true);
    expect(decodeYamlSequenceField(yamlSequenceOwnership).filePreviouslyPresent).toBe(true);
  });

  it("accepts an inserted YAML key prefix when the key did not exist", () => {
    expect(() =>
      decodeYamlSequenceField({ ...yamlSequenceOwnership, keyPreviouslyPresent: false, insertedPrefix: "\n" }),
    ).not.toThrow();
  });

  it.each([
    {
      name: "a pre-existing key with an inserted prefix",
      fields: { insertedPrefix: "\n" },
      issue: /prefix|frame|key/i,
    },
    {
      name: "a reference older than its key",
      fields: { keyPreviouslyPresent: false, previouslyPresent: true },
      issue: /previous|key/i,
    },
    {
      name: "a custom prefix",
      fields: { keyPreviouslyPresent: false, insertedPrefix: "custom" },
      issue: /prefix|frame/i,
    },
  ])("rejects YAML key-lifetime evidence with $name", ({ fields, issue }) => {
    expect(() => decodeYamlSequenceField({ ...yamlSequenceOwnership, ...fields })).toThrow(issue);
  });

  it.each([
    { agentIds: [], issue: /./ },
    { agentIds: ["codex", "codex"], issue: /unique/i },
    { agentIds: ["unknown-agent"], issue: /agent|catalog|unknown/i },
    { agentIds: ["aider", "codex"], issue: /agent|catalog|order/i },
  ])("requires non-empty, unique, known agent ownership IDs in catalog order: $agentIds", ({ agentIds, issue }) => {
    expect(() => decodeOwner({ _tag: "agent", agentIds })).toThrow(issue);
  });

  it("rejects equal managed-block markers", () => {
    expect(() =>
      createStrictDecoder(managedBlockOwnershipSchema)({
        ...managedBlockOwnership,
        startMarker: "marker",
        endMarker: "marker",
      }),
    ).toThrow(/endMarker/);
  });

  it.each([
    createOwnedFile("runtime", { owner: agentOwner, path: "runtime.js", ownership: wholeFileOwnership }),
    createOwnedFile("skill", { owner: applicationOwner, path: "skill/SKILL.md", ownership: wholeFileOwnership }),
    createOwnedFile("instruction", { owner: agentOwner, path: "AGENTS.md", ownership: wholeFileOwnership }),
    createOwnedFile("settings", { owner: agentOwner, path: "settings.json", ownership: documentFieldsOwnership }),
    createOwnedFile("settings", { owner: applicationOwner, path: "settings.yml", ownership: yamlSequenceOwnership }),
    createOwnedFile("instructionLink", { owner: agentOwner, path: "config.json", ownership: managedBlockOwnership }),
    createOwnedFile("managedConfig", { owner: agentOwner, path: "managed-config.json", ownership: wholeFileOwnership }),
  ])("rejects incompatible owner or ownership combinations", (line) => {
    expect(() => decodeOwnedFile(line)).toThrow(/owner|ownership/i);
  });

  const runtimeOwnedFile = createOwnedFile("runtime", {
    owner: applicationOwner,
    path: "hooks/guard.js",
    ownership: wholeFileOwnership,
  });
  const instructionOwnedFile = createOwnedFile("instruction", {
    owner: sharedAgentOwner,
    path: "AGENTS.md",
    ownership: managedBlockOwnership,
  });

  it.each([
    { name: "duplicate", files: [runtimeOwnedFile, runtimeOwnedFile] },
    { name: "parent-child", files: [runtimeOwnedFile, { ...runtimeOwnedFile, path: "hooks/guard.js/map" }] },
    { name: "case-folded", files: [instructionOwnedFile, { ...instructionOwnedFile, path: "agents.md" }] },
  ])("rejects $name file paths", ({ files }) => {
    expect(() => decodeReceipt(createReceiptWithFiles(files))).toThrow(/path/i);
  });

  it.each([
    ["duplicate features", ["scratch-folder-guard", "scratch-folder-guard"]],
    ["unknown feature", ["unknown-feature"]],
    ["non-catalog order", ["make-code-readable", "scratch-folder-guard"]],
  ])("rejects %s in receipt features", (_case, features) => {
    expect(() => decodeReceipt({ ...createReceiptWithFiles([]), features })).toThrow(/feature|catalog order/i);
  });

  it("reads a receipt that lists a feature but not its dependency added later", () => {
    const features = ["organize-commits", "finish-and-push", "run-local-and-check", "run-tasks-in-parallel"];

    expect(decodeReceipt({ ...createReceiptWithFiles([]), features }).features).toEqual(features);
  });

  it("reads retired feature IDs as the features that replaced them", () => {
    const features = [
      "question-my-plan",
      "code-style-new-project",
      "code-style-existing-project",
      "question-plan-with-docs",
    ];

    expect(decodeReceipt({ ...createReceiptWithFiles([]), features }).features).toEqual([
      "question-my-plan",
      "code-style",
    ]);
  });
});

describe("readReceipt", () => {
  it("returns a missing snapshot when no receipt file exists at the requested path", async () => {
    const receiptFilePath = path.join(makeTemporaryRoot("agent-setup-receipt-"), "receipt.json");

    const missing = await readReceipt(receiptFilePath);

    expect(missing).toEqual({ _tag: "missing" });
  });

  it("returns a present snapshot with the exact bytes and the decoded receipt", async () => {
    const bytes = stringEncoder.encode(`\n${completeReceiptDocument}\n`);
    const receiptFilePath = writeReceiptFile(bytes);

    const present = await readReceipt(receiptFilePath);

    expect(present).toEqual({ _tag: "present", bytes, receipt: completeReceipt });
  });

  it("rejects malformed UTF-8 instead of accepting replacement characters", async () => {
    const markerIndex = completeReceiptDocument.indexOf("scratch-folder-guard.js");
    const bytes = new Uint8Array([
      ...stringEncoder.encode(completeReceiptDocument.slice(0, markerIndex)),
      0xff,
      ...stringEncoder.encode(completeReceiptDocument.slice(markerIndex + 1)),
    ]);
    const receiptFilePath = writeReceiptFile(bytes);

    await expect(readReceipt(receiptFilePath)).rejects.toThrow(receiptFilePath);
    await expect(readReceipt(receiptFilePath)).rejects.toThrow("UTF-8");
  });

  it.each([
    {
      name: "a leading UTF-8 byte-order mark",
      bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...stringEncoder.encode(completeReceiptDocument)]),
      fragments: ["byte-order mark"],
    },
    {
      name: "duplicate JSON properties whose names use different escapes",
      bytes: stringEncoder.encode(
        completeReceiptDocument.replace('"version":"1.0.0"', '"\\u0076ersion":"1.0.0","version":"1.0.0"'),
      ),
      fragments: ["duplicate JSON property", "version"],
    },
    { name: "malformed JSON", bytes: stringEncoder.encode("{not-json"), fragments: ["receipt.json"] },
    {
      name: "a receipt schema failure",
      bytes: stringEncoder.encode(
        JSON.stringify({ version: "1.0.0", scope: "project", features: [], ownedFiles: [], unexpected: true }),
      ),
      fragments: ["unexpected"],
    },
  ])("rejects $name with one tagged error", async ({ bytes, fragments }) => {
    const receiptFilePath = writeReceiptFile(bytes);

    for (const fragment of fragments) {
      await expect(readReceipt(receiptFilePath)).rejects.toThrow(fragment);
    }
  });
});
