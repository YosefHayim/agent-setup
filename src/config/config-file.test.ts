import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  assertManagedSettingsPlan,
  type ManagedConfigPlan,
  managedSettingsPath,
  planManagedSettings,
  readSettingsFile,
} from "./config-file.js";
import { type Config, defaultSettings, encodeSettingsDocument } from "./config-schema.js";

const stringEncoder = new TextEncoder();

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

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

const writeSettingsMessages = (messages: Uint8Array | string): string => {
  const root = makeTemporaryRoot("agent-setup-config-file-");
  const settingsPath = path.join(root, "config.json");
  const isStringMessage = typeof messages === "string";
  writeFileSync(settingsPath, isStringMessage ? stringEncoder.encode(messages) : messages);
  return settingsPath;
};

const createBytesWithInvalidUtf8 = () => {
  const marker = "replacement-marker";
  const decodedSettingsFile = JSON.stringify({ ...defaultSettings, sessionRehomeRoots: [marker] });
  const markerIndex = decodedSettingsFile.indexOf(marker);
  return new Uint8Array([
    ...stringEncoder.encode(decodedSettingsFile.slice(0, markerIndex)),
    0xff,
    ...stringEncoder.encode(decodedSettingsFile.slice(markerIndex + marker.length)),
  ]);
};

describe("readSettingsFile", () => {
  it("returns a tagged missing snapshot when the managed config is absent", async () => {
    const root = makeTemporaryRoot("agent-setup-config-file-missing-");

    await expect(readSettingsFile(path.join(root, "config.json"))).resolves.toEqual({ _tag: "missing" });
  });

  it("returns exact file bytes with one strict complete managed config", async () => {
    const bytes = stringEncoder.encode(`\n${encodeSettingsDocument(defaultSettings)}\n`);

    const snapshot = await readSettingsFile(writeSettingsMessages(bytes));

    expect(snapshot._tag === "present" && [...snapshot.bytes]).toEqual([...bytes]);
    expect(snapshot._tag === "present" && snapshot.config).toEqual(defaultSettings);
  });

  it("applies schema defaults to an incomplete config", async () => {
    const snapshot = await readSettingsFile(writeSettingsMessages(JSON.stringify({ debugLogs: true })));

    expect(snapshot._tag === "present" && snapshot.config).toEqual({ ...defaultSettings, debugLogs: true });
  });

  it.each([
    { name: "malformed JSON", contents: "{not-json", mentions: "config.json" },
    {
      name: "an excess property",
      contents: JSON.stringify({ ...defaultSettings, unexpected: true }),
      mentions: "unexpected",
    },
    {
      name: "an empty root folder",
      contents: JSON.stringify({ ...defaultSettings, sessionRehomeRoots: [""] }),
      mentions: "sessionRehomeRoots",
    },
    { name: "non-UTF-8 bytes", contents: createBytesWithInvalidUtf8(), mentions: "UTF-8" },
    {
      name: "duplicate properties that JSON parsing would collapse",
      contents: JSON.stringify(defaultSettings).replace(
        `"debugLogs":${String(defaultSettings.debugLogs)}`,
        '"\\u0064ebugLogs":false,"debugLogs":true',
      ),
      mentions: 'duplicate JSON property "debugLogs"',
    },
    {
      name: "a UTF-8 byte-order mark",
      contents: new Uint8Array([0xef, 0xbb, 0xbf, ...stringEncoder.encode(JSON.stringify(defaultSettings))]),
      mentions: "byte-order mark",
    },
  ])("rejects $name", async ({ contents: messages, mentions }) => {
    await expect(readSettingsFile(writeSettingsMessages(messages))).rejects.toThrow(mentions);
  });

  it("preserves non-missing filesystem errors", async () => {
    const root = makeTemporaryRoot("agent-setup-config-file-read-error-");

    await expect(readSettingsFile(root)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

const missingPrevious = { _tag: "missing" };

const createPresentSettingsSnapshot = (settings: Config) => ({
  _tag: "present",
  bytes: stringEncoder.encode(`${JSON.stringify(settings)}\n`),
  config: settings,
});

const createSelectedRequest = (scope: "global" | "project", settings: Config) => ({
  scope,
  selection: { _tag: "selected", config: settings },
  previousConfigFile: missingPrevious,
});

const readWholeFileOwnership = (plan: ManagedConfigPlan) => {
  const ownership = plan.managedConfigWrite.file.ownership;
  const isNotWholeFileOwnership = ownership._tag !== "wholeFile";

  if (isNotWholeFileOwnership) {
    throw new Error("Expected one whole-file managed config write.");
  }

  return ownership;
};

const expectManagedSettingsWrite = (plan: ManagedConfigPlan) => {
  expect(plan.managedConfigWrite.file.path).toBe(managedSettingsPath);
  expect(plan.managedConfigWrite.file.kind._tag).toBe("managedConfig");
  expect(readWholeFileOwnership(plan).installedHash).toBe(hashBytes(plan.managedConfigWrite.bytes));
  expect(new TextDecoder().decode(plan.managedConfigWrite.bytes)).toContain('"debugLogs"');
};

describe("planManagedSettings", () => {
  it("copies the global snapshot once for a first project install and otherwise uses defaults", () => {
    const globalSettings = { ...defaultSettings, sessionRehomeRoots: ["fixtures"], debugLogs: true };
    const copied = planManagedSettings({
      scope: "project",
      selection: { _tag: "firstProjectInstall", globalConfig: createPresentSettingsSnapshot(globalSettings) },
      previousConfigFile: missingPrevious,
    });
    const defaulted = planManagedSettings({
      scope: "project",
      selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
      previousConfigFile: missingPrevious,
    });

    expect(copied.config).toEqual(globalSettings);
    expect(defaulted.config).toEqual(defaultSettings);
    expectManagedSettingsWrite(copied);
    expectManagedSettingsWrite(defaulted);
  });

  it("rejects a global snapshot whose decoded config does not match its source bytes", () => {
    const originSettings = { ...defaultSettings, sessionRehomeRoots: ["fixtures"] };
    const globalSnapshot = {
      ...createPresentSettingsSnapshot(originSettings),
      config: { ...originSettings, sessionRehomeRoots: ["vendor"] },
    };

    expect(() =>
      planManagedSettings({
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig: globalSnapshot },
        previousConfigFile: missingPrevious,
      }),
    ).toThrow("source bytes");
  });

  it("rejects first-project selection in global scope", () => {
    expect(() =>
      planManagedSettings({
        scope: "global",
        selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
        previousConfigFile: missingPrevious,
      }),
    ).toThrow("project");
  });

  it("rejects a first project selection when a target config already exists", () => {
    expect(() =>
      planManagedSettings({
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
        previousConfigFile: { _tag: "priorFile", bytes: stringEncoder.encode("original config") },
      }),
    ).toThrow("missing target managed config");
  });

  it("keeps later global and project selections independent", () => {
    const global = planManagedSettings(
      createSelectedRequest("global", { ...defaultSettings, sessionRehomeRoots: ["vendor"] }),
    );
    const project = planManagedSettings(
      createSelectedRequest("project", { ...defaultSettings, sessionRehomeRoots: ["generated"] }),
    );

    expect(global.config.sessionRehomeRoots).toEqual(["vendor"]);
    expect(project.config.sessionRehomeRoots).toEqual(["generated"]);
    expect(global.managedConfigWrite).not.toEqual(project.managedConfigWrite);
  });

  it("preserves exact prior config bytes and correlates desired bytes with their hash", () => {
    const priorBytes = stringEncoder.encode('{  "user": "format"  }\n');
    const plan = planManagedSettings({
      scope: "project",
      selection: { _tag: "selected", config: defaultSettings },
      previousConfigFile: { _tag: "priorFile", bytes: priorBytes },
    });

    expect(readWholeFileOwnership(plan).previous).toEqual({ _tag: "priorFile", bytes: priorBytes });
    expect(readWholeFileOwnership(plan).installedHash).toBe(hashBytes(plan.managedConfigWrite.bytes));
  });

  it("strictly rejects unknown request properties", () => {
    expect(() =>
      planManagedSettings({
        ...createSelectedRequest("project", defaultSettings),
        unexpected: true,
      }),
    ).toThrow("Unrecognized key");
  });

  it("rejects managed plan data whose config and write drift apart", () => {
    const plan = planManagedSettings(createSelectedRequest("project", defaultSettings));
    const bytes = stringEncoder.encode(
      `${JSON.stringify({ ...defaultSettings, sessionRehomeRoots: ["different"] }, null, 2)}\n`,
    );

    expect(() =>
      assertManagedSettingsPlan({
        ...plan,
        managedConfigWrite: {
          ...plan.managedConfigWrite,
          file: {
            ...plan.managedConfigWrite.file,
            ownership: { ...readWholeFileOwnership(plan), installedHash: hashBytes(bytes) },
          },
          bytes,
        },
      }),
    ).toThrow("must encode");
  });
});
