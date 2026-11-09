import { FileSystem } from "@effect/platform";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  fileKindSchema,
  fileOwnerSchema,
  hookEntriesOwnershipSchema,
  jsonPointerSchema,
  jsonValuesOwnershipSchema,
  managedBlockOwnershipSchema,
  type OwnedFile,
  ownedFileSchema,
  previousFileValueSchema,
  previousJsonValueSchema,
  relativePathSchema,
  sha256Schema,
  yamlSequenceValueOwnershipSchema,
} from "./ownership.js";
import {
  decodeReceiptJson,
  type Receipt,
  ReceiptParseError,
  readReceipt,
  receiptJsonSchema,
  receiptSchema,
} from "./receipt.js";

const installedHash = "a".repeat(64);
const installedValueHash = "b".repeat(64);
const receiptPath = "/workspace/.claude/agent-setup/receipt.json";
const textEncoder = new TextEncoder();

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

const ownedValue = (pointer: string, previous: object = missingPrevious) => ({
  pointer,
  installed: { _tag: "value", hash: installedValueHash },
  previous,
});

const jsonValues = (values: ReadonlyArray<object>, createdContainers: ReadonlyArray<string> = []) => ({
  _tag: "jsonValues",
  filePreviouslyPresent: true,
  createdContainers,
  values,
});

const jsonValuesOwnership = jsonValues([
  ownedValue("/hooks/PreToolUse"),
  { pointer: "/enabled", installed: { _tag: "value", hash: installedHash }, previous: { _tag: "value", value: false } },
]);

const settingsJsonValuesOwnership = jsonValues([
  ownedValue("/hooks/PreToolUse"),
  {
    pointer: "/enabled",
    installed: { _tag: "value", hash: installedHash },
    previous: { _tag: "value", value: false, lexical: { _tag: "value", source: "false" } },
  },
]);

const hookEntries = (
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

const ownedFile = (kind: string, file: { owner: object; path: string; ownership: object }) => ({
  ...file,
  kind: { _tag: kind },
});

const completeReceiptInput = {
  version: "1.0.0",
  scope: "project",
  features: ["scratch-folder-guard", "make-code-readable"],
  ownedFiles: [
    ownedFile("runtime", {
      owner: applicationOwner,
      path: ".claude/agent-setup/hooks/scratch-folder-guard/hooks/scratch-folder-guard.js",
      ownership: { ...wholeFileOwnership, previous: { _tag: "priorFile", bytes: "AQID" } },
    }),
    ownedFile("skill", {
      owner: agentOwner,
      path: ".claude/skills/make-code-readable/SKILL.md",
      ownership: wholeFileOwnership,
    }),
    ownedFile("rule", {
      owner: agentOwner,
      path: ".cursor/rules/make-code-readable.mdc",
      ownership: wholeFileOwnership,
    }),
    ownedFile("instruction", { owner: sharedAgentOwner, path: "AGENTS.md", ownership: managedBlockOwnership }),
    ownedFile("instructionLink", { owner: agentOwner, path: ".continue/config.json", ownership: jsonValuesOwnership }),
    ownedFile("instructionLink", { owner: agentOwner, path: ".aider.conf.yml", ownership: yamlSequenceOwnership }),
    ownedFile("settings", {
      owner: applicationOwner,
      path: ".claude/settings.json",
      ownership: settingsJsonValuesOwnership,
    }),
    ownedFile("managedConfig", {
      owner: applicationOwner,
      path: ".claude/agent-setup/config.json",
      ownership: wholeFileOwnership,
    }),
  ],
};

const strictDecoder = <Type, Encoded>(schema: Schema.Schema<Type, Encoded>) =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: "error" });

const decodeReceipt = strictDecoder(receiptSchema);
const decodeEntry = strictDecoder(ownedFileSchema);
const decodeOwner = strictDecoder(fileOwnerSchema);
const decodeKind = strictDecoder(fileKindSchema);
const decodePreviousFile = strictDecoder(previousFileValueSchema);
const decodePreviousJson = strictDecoder(previousJsonValueSchema);
const decodeJsonValues = strictDecoder(jsonValuesOwnershipSchema);
const decodeYamlSequenceValue = strictDecoder(yamlSequenceValueOwnershipSchema);
const decodeHookEntries = strictDecoder(hookEntriesOwnershipSchema);
const encodeReceiptJson = Schema.encodeSync(receiptJsonSchema);

const completeReceipt = decodeReceipt(completeReceiptInput);
const completeReceiptJson = encodeReceiptJson(completeReceipt);

const receiptWithFiles = (files: ReadonlyArray<unknown>) => ({
  version: "1.0.0",
  scope: "project",
  features: ["scratch-folder-guard"],
  ownedFiles: files,
});

const roundTrip = (files: ReadonlyArray<unknown>) =>
  decodeReceiptJson(encodeReceiptJson(decodeReceipt(receiptWithFiles(files))));

const readFixtureReceipt = (bytes: Uint8Array) =>
  readReceipt(receiptPath).pipe(
    Effect.provide(
      FileSystem.layerNoop({
        readFile: (path) =>
          Effect.sync(() => {
            expect(path).toBe(receiptPath);

            return bytes;
          }),
      }),
    ),
  );

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
    const receiptEntry = ownedFile("receipt", {
      owner: applicationOwner,
      path: ".claude/agent-setup/receipt.json",
      ownership: wholeFileOwnership,
    });

    expect(kindTags.map((_tag) => decodeKind({ _tag })._tag)).toEqual(kindTags);
    expect(decodeEntry(receiptEntry).kind._tag).toBe("receipt");
    expect(() => decodeReceipt(receiptWithFiles([receiptEntry]))).toThrow(/itself|receipt/i);
  });

  it.effect("round-trips every receipt field through the JSON codec", () =>
    Effect.gen(function* () {
      const encoded = JSON.parse(completeReceiptJson);

      expect(Object.keys(encoded)).toEqual(["version", "scope", "features", "ownedFiles"]);
      expect(encoded.ownedFiles[0].ownership.previous.bytes).toBe("AQID");
      expect(yield* decodeReceiptJson(completeReceiptJson)).toEqual(completeReceipt);
    }),
  );

  it.effect("preserves host-file existence for member-level ownership through receipt JSON", () =>
    Effect.gen(function* () {
      const receipt = yield* roundTrip([
        ownedFile("instruction", { owner: sharedAgentOwner, path: "AGENTS.md", ownership: managedBlockOwnership }),
        ownedFile("instructionLink", {
          owner: agentOwner,
          path: ".continue/config.json",
          ownership: {
            ...jsonValuesOwnership,
            filePreviouslyPresent: false,
            values: jsonValuesOwnership.values.map((value) => ({ ...value, previous: missingPrevious })),
          },
        }),
        ownedFile("instructionLink", { owner: agentOwner, path: ".aider.conf.yml", ownership: yamlSequenceOwnership }),
      ]);

      expect(receipt.ownedFiles.map((file) => file.ownership)).toMatchObject([
        { _tag: "managedBlock", filePreviouslyPresent: true },
        { _tag: "jsonValues", filePreviouslyPresent: false },
        { _tag: "yamlSequenceValue", filePreviouslyPresent: true },
      ]);
    }),
  );

  it.effect("round-trips members acquired after a receipt first created their host files", () =>
    Effect.gen(function* () {
      const receipt = yield* roundTrip([
        ownedFile("instructionLink", {
          owner: agentOwner,
          path: ".continue/config.json",
          ownership: { ...jsonValuesOwnership, filePreviouslyPresent: false },
        }),
        ownedFile("instructionLink", {
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
    }),
  );

  it.effect.each([
    { ...completeReceiptInput, unexpected: true },
    { ...completeReceiptInput, detectedAgents: ["codex"] },
  ])("rejects receipt-level excess or detection evidence", (input) =>
    Effect.gen(function* () {
      expect(() => decodeReceipt(input)).toThrow();
      expect((yield* Effect.either(decodeReceiptJson(JSON.stringify(input))))._tag).toBe("Left");
    }),
  );

  it.each([
    { name: "owner", decode: () => decodeOwner({ _tag: "application", extra: true }) },
    { name: "kind", decode: () => decodeKind({ _tag: "runtime", extra: true }) },
    { name: "previous file", decode: () => decodePreviousFile({ _tag: "missing", extra: true }) },
    { name: "previous JSON value", decode: () => decodePreviousJson({ _tag: "value", value: null, extra: true }) },
    { name: "owned file", decode: () => decodeEntry({ ...completeReceiptInput.ownedFiles[0], extra: true }) },
    {
      name: "owned JSON value",
      decode: () => decodeJsonValues(jsonValues([{ ...ownedValue("/value"), extra: true }])),
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
    expect(() => Schema.decodeUnknownSync(relativePathSchema)(path)).toThrow();
  });

  it.each([".claude/settings.json", "AGENTS.md"])("accepts normalized relative path %j", (path) => {
    expect(Schema.decodeUnknownSync(relativePathSchema)(path)).toBe(path);
  });

  it.each(["a".repeat(63), "A".repeat(64), `${"a".repeat(63)}g`, ""])("rejects invalid SHA-256 %j", (hash) => {
    expect(() => Schema.decodeUnknownSync(sha256Schema)(hash)).toThrow();
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
    expect(() => Schema.decodeUnknownSync(jsonPointerSchema)(pointer)).toThrow();
  });

  it.each(["/rules/0", "/a~1b/~0key"])("accepts escaped absolute JSON pointer %j", (pointer) => {
    expect(Schema.decodeUnknownSync(jsonPointerSchema)(pointer)).toBe(pointer);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, new Date("2026-01-01T00:00:00.000Z")])(
    "rejects a non-JSON previous value",
    (value) => {
      expect(() => decodePreviousJson({ _tag: "value", value })).toThrow();
    },
  );

  it.each([
    { name: "duplicate", pointers: ["/rules", "/rules"] },
    { name: "parent-child", pointers: ["/rules", "/rules/0"] },
  ])("rejects $name JSON pointers", ({ pointers }) => {
    expect(() => decodeJsonValues(jsonValues(pointers.map((pointer) => ownedValue(pointer))))).toThrow(/pointer/i);
  });

  it("records hashed installed JSON states with exact created containers", () => {
    const ownership = decodeJsonValues(jsonValues([ownedValue("/hooks/PreToolUse")], ["/hooks"]));

    expect(ownership.createdContainers).toEqual(["/hooks"]);
    expect(ownership.values.map((value) => value.installed)).toEqual([{ _tag: "value", hash: installedValueHash }]);
  });

  it.each([
    { name: "duplicate", createdContainers: ["/hooks", "/hooks"] },
    { name: "unrelated", createdContainers: ["/permissions"] },
    { name: "owned value itself", createdContainers: ["/hooks/Stop"] },
  ])("rejects $name created JSON containers", ({ createdContainers }) => {
    expect(() =>
      decodeJsonValues(jsonValues([ownedValue("/hooks/Stop", { _tag: "value", value: [] })], createdContainers)),
    ).toThrow(/container|ancestor|unique/i);
  });

  it("records the hash of each owned hook entry per event with exact created containers", () => {
    const ownership = decodeHookEntries(
      hookEntries([{ pointer: "/hooks/Stop", entries: [installedValueHash, installedValueHash] }], ["/hooks"]),
    );

    expect(ownership.createdContainers).toEqual(["/hooks"]);
    expect(ownership.events).toEqual([
      { pointer: "/hooks/Stop", previouslyPresent: false, entries: [installedValueHash, installedValueHash] },
    ]);
  });

  it.each([
    { name: "nested hook entry pointer", events: [{ pointer: "/hooks/Stop/0", entries: [installedValueHash] }] },
    { name: "non-hook pointer", events: [{ pointer: "/permissions", entries: [installedValueHash] }] },
    { name: "escaped event name", events: [{ pointer: "/hooks/foo~1bar", entries: [installedValueHash] }] },
    { name: "event without entries", events: [{ pointer: "/hooks/Stop", entries: [] }] },
    { name: "missing events", events: [] },
    {
      name: "duplicate events",
      events: [
        { pointer: "/hooks/Stop", entries: [installedValueHash] },
        { pointer: "/hooks/Stop", entries: [installedHash] },
      ],
    },
  ])("rejects hook entry ownership with a $name", ({ events }) => {
    expect(() => decodeHookEntries(hookEntries(events))).toThrow();
  });

  it("rejects a hook entry created container that holds no owned event", () => {
    expect(() =>
      decodeHookEntries(hookEntries([{ pointer: "/hooks/Stop", entries: [installedValueHash] }], ["/permissions"])),
    ).toThrow(/container|ancestor/i);
  });

  it("allows missing owned members when the host file previously existed", () => {
    expect(decodeJsonValues(jsonValues([ownedValue("/rules")])).filePreviouslyPresent).toBe(true);
    expect(decodeYamlSequenceValue(yamlSequenceOwnership).filePreviouslyPresent).toBe(true);
  });

  it("accepts an inserted YAML key prefix when the key did not exist", () => {
    expect(() =>
      decodeYamlSequenceValue({ ...yamlSequenceOwnership, keyPreviouslyPresent: false, insertedPrefix: "\n" }),
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
    expect(() => decodeYamlSequenceValue({ ...yamlSequenceOwnership, ...fields })).toThrow(issue);
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
      strictDecoder(managedBlockOwnershipSchema)({
        ...managedBlockOwnership,
        startMarker: "marker",
        endMarker: "marker",
      }),
    ).toThrow(/endMarker/);
  });

  it.each([
    ownedFile("runtime", { owner: agentOwner, path: "runtime.js", ownership: wholeFileOwnership }),
    ownedFile("skill", { owner: applicationOwner, path: "skill/SKILL.md", ownership: wholeFileOwnership }),
    ownedFile("instruction", { owner: agentOwner, path: "AGENTS.md", ownership: wholeFileOwnership }),
    ownedFile("settings", { owner: agentOwner, path: "settings.json", ownership: jsonValuesOwnership }),
    ownedFile("settings", { owner: applicationOwner, path: "settings.yml", ownership: yamlSequenceOwnership }),
    ownedFile("instructionLink", { owner: agentOwner, path: "config.json", ownership: managedBlockOwnership }),
    ownedFile("managedConfig", { owner: agentOwner, path: "managed-config.json", ownership: wholeFileOwnership }),
  ])("rejects incompatible owner or ownership combinations", (entry) => {
    expect(() => decodeEntry(entry)).toThrow(/owner|ownership/i);
  });

  const runtimeEntry = ownedFile("runtime", {
    owner: applicationOwner,
    path: "hooks/guard.js",
    ownership: wholeFileOwnership,
  });
  const instructionEntry = ownedFile("instruction", {
    owner: sharedAgentOwner,
    path: "AGENTS.md",
    ownership: managedBlockOwnership,
  });

  it.each([
    { name: "duplicate", files: [runtimeEntry, runtimeEntry] },
    { name: "parent-child", files: [runtimeEntry, { ...runtimeEntry, path: "hooks/guard.js/map" }] },
    { name: "case-folded", files: [instructionEntry, { ...instructionEntry, path: "agents.md" }] },
  ])("rejects $name file paths", ({ files }) => {
    expect(() => decodeReceipt(receiptWithFiles(files))).toThrow(/path/i);
  });

  it.each([
    ["duplicate features", ["scratch-folder-guard", "scratch-folder-guard"]],
    ["unknown feature", ["unknown-feature"]],
    ["non-catalog order", ["make-code-readable", "scratch-folder-guard"]],
  ])("rejects %s in receipt features", (_case, features) => {
    expect(() => decodeReceipt({ ...receiptWithFiles([]), features })).toThrow(/feature|catalog order/i);
  });

  it("reads a receipt that lists a feature but not its dependency added later", () => {
    const features = ["organize-commits", "finish-and-push", "run-local-and-check", "run-tasks-in-parallel"];

    expect(decodeReceipt({ ...receiptWithFiles([]), features }).features).toEqual(features);
  });

  it("reads retired feature IDs as the features that replaced them", () => {
    const features = [
      "question-my-plan",
      "code-style-new-project",
      "code-style-existing-project",
      "question-plan-with-docs",
    ];

    expect(decodeReceipt({ ...receiptWithFiles([]), features }).features).toEqual(["question-my-plan", "code-style"]);
  });
});

describe("readReceipt", () => {
  it.effect("returns tagged missing or present snapshots from the requested path", () =>
    Effect.gen(function* () {
      const bytes = textEncoder.encode(`\n${completeReceiptJson}\n`);
      const missing = yield* readReceipt(receiptPath).pipe(Effect.provide(FileSystem.layerNoop({})));
      const present = yield* readFixtureReceipt(bytes);

      expect(missing).toEqual({ _tag: "missing" });
      expect(present).toEqual({ _tag: "present", bytes, receipt: completeReceipt });
      if (present._tag === "present") {
        expect(present.bytes).toBe(bytes);
      }
    }),
  );

  it.effect("rejects malformed UTF-8 instead of accepting replacement characters", () =>
    Effect.gen(function* () {
      const markerIndex = completeReceiptJson.indexOf("scratch-folder-guard.js");
      const bytes = new Uint8Array([
        ...textEncoder.encode(completeReceiptJson.slice(0, markerIndex)),
        0xff,
        ...textEncoder.encode(completeReceiptJson.slice(markerIndex + 1)),
      ]);
      const error = yield* Effect.flip(readFixtureReceipt(bytes));

      expect(error).toBeInstanceOf(ReceiptParseError);
      expect(error.message).toContain(receiptPath);
      expect(error.message).toContain("UTF-8");
    }),
  );

  it.effect.each([
    {
      name: "a leading UTF-8 byte-order mark",
      bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...textEncoder.encode(completeReceiptJson)]),
      fragments: ["byte-order mark"],
    },
    {
      name: "duplicate JSON properties whose names use different escapes",
      bytes: textEncoder.encode(
        completeReceiptJson.replace('"version":"1.0.0"', '"\\u0076ersion":"1.0.0","version":"1.0.0"'),
      ),
      fragments: ["duplicate JSON property", "version"],
    },
    { name: "malformed JSON", bytes: textEncoder.encode("{not-json"), fragments: [receiptPath] },
    {
      name: "a receipt schema failure",
      bytes: textEncoder.encode(
        JSON.stringify({ version: "1.0.0", scope: "project", features: [], ownedFiles: [], unexpected: true }),
      ),
      fragments: ["unexpected"],
    },
  ])("rejects $name with one tagged error", ({ bytes, fragments }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(readFixtureReceipt(bytes));

      expect(error).toBeInstanceOf(ReceiptParseError);
      for (const fragment of fragments) {
        expect(error.message).toContain(fragment);
      }
    }),
  );
});
