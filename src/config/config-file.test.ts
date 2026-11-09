import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  assertManagedConfigPlan,
  type ManagedConfigPlan,
  managedConfigPath,
  planManagedConfig,
  readConfigFile,
} from "./config-file.js";
import { type Config, defaultConfig, encodeConfigJson } from "./config-schema.js";

const textEncoder = new TextEncoder();

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

const writeConfigContents = (contents: Uint8Array | string): string => {
  const root = makeTemporaryRoot("agent-setup-config-file-");
  const configPath = path.join(root, "config.json");
  writeFileSync(configPath, typeof contents === "string" ? textEncoder.encode(contents) : contents);
  return configPath;
};

const bytesWithInvalidUtf8 = () => {
  const marker = "replacement-marker";
  const json = JSON.stringify({ ...defaultConfig, sessionRehomeRoots: [marker] });
  const markerIndex = json.indexOf(marker);
  return new Uint8Array([
    ...textEncoder.encode(json.slice(0, markerIndex)),
    0xff,
    ...textEncoder.encode(json.slice(markerIndex + marker.length)),
  ]);
};

describe("readConfigFile", () => {
  it("returns a tagged missing snapshot when the managed config is absent", async () => {
    const root = makeTemporaryRoot("agent-setup-config-file-missing-");

    await expect(readConfigFile(path.join(root, "config.json"))).resolves.toEqual({ _tag: "missing" });
  });

  it("returns exact file bytes with one strict complete managed config", async () => {
    const bytes = textEncoder.encode(`\n${encodeConfigJson(defaultConfig)}\n`);

    const snapshot = await readConfigFile(writeConfigContents(bytes));

    expect(snapshot._tag === "present" && [...snapshot.bytes]).toEqual([...bytes]);
    expect(snapshot._tag === "present" && snapshot.config).toEqual(defaultConfig);
  });

  it("applies schema defaults to an incomplete config", async () => {
    const snapshot = await readConfigFile(writeConfigContents(JSON.stringify({ debugLogs: true })));

    expect(snapshot._tag === "present" && snapshot.config).toEqual({ ...defaultConfig, debugLogs: true });
  });

  it.each([
    { name: "malformed JSON", contents: "{not-json", mentions: "config.json" },
    {
      name: "an excess property",
      contents: JSON.stringify({ ...defaultConfig, unexpected: true }),
      mentions: "unexpected",
    },
    {
      name: "an empty root folder",
      contents: JSON.stringify({ ...defaultConfig, sessionRehomeRoots: [""] }),
      mentions: "sessionRehomeRoots",
    },
    { name: "non-UTF-8 bytes", contents: bytesWithInvalidUtf8(), mentions: "UTF-8" },
    {
      name: "duplicate properties that JSON parsing would collapse",
      contents: JSON.stringify(defaultConfig).replace(
        `"debugLogs":${String(defaultConfig.debugLogs)}`,
        '"\\u0064ebugLogs":false,"debugLogs":true',
      ),
      mentions: 'duplicate JSON property "debugLogs"',
    },
    {
      name: "a UTF-8 byte-order mark",
      contents: new Uint8Array([0xef, 0xbb, 0xbf, ...textEncoder.encode(JSON.stringify(defaultConfig))]),
      mentions: "byte-order mark",
    },
  ])("rejects $name", async ({ contents, mentions }) => {
    await expect(readConfigFile(writeConfigContents(contents))).rejects.toThrow(mentions);
  });

  it("preserves non-missing filesystem errors", async () => {
    const root = makeTemporaryRoot("agent-setup-config-file-read-error-");

    await expect(readConfigFile(root)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

const missingPrevious = { _tag: "missing" };

const presentConfigSnapshot = (config: Config) => ({
  _tag: "present",
  bytes: textEncoder.encode(`${JSON.stringify(config)}\n`),
  config,
});

const selectedRequest = (scope: "global" | "project", config: Config) => ({
  scope,
  selection: { _tag: "selected", config },
  previousConfigFile: missingPrevious,
});

const wholeFileOwnership = (plan: ManagedConfigPlan) => {
  if (plan.managedConfigWrite.file.ownership._tag !== "wholeFile") {
    throw new Error("Expected one whole-file managed config write.");
  }

  return plan.managedConfigWrite.file.ownership;
};

const expectManagedConfigWrite = (plan: ManagedConfigPlan) => {
  expect(plan.managedConfigWrite.file.path).toBe(managedConfigPath);
  expect(plan.managedConfigWrite.file.kind._tag).toBe("managedConfig");
  expect(wholeFileOwnership(plan).installedHash).toBe(hashBytes(plan.managedConfigWrite.bytes));
  expect(new TextDecoder().decode(plan.managedConfigWrite.bytes)).toContain('"debugLogs"');
};

describe("planManagedConfig", () => {
  it("copies the global snapshot once for a first project install and otherwise uses defaults", () => {
    const globalConfig = { ...defaultConfig, sessionRehomeRoots: ["fixtures"], debugLogs: true };
    const copied = planManagedConfig({
      scope: "project",
      selection: { _tag: "firstProjectInstall", globalConfig: presentConfigSnapshot(globalConfig) },
      previousConfigFile: missingPrevious,
    });
    const defaulted = planManagedConfig({
      scope: "project",
      selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
      previousConfigFile: missingPrevious,
    });

    expect(copied.config).toEqual(globalConfig);
    expect(defaulted.config).toEqual(defaultConfig);
    expectManagedConfigWrite(copied);
    expectManagedConfigWrite(defaulted);
  });

  it("rejects a global snapshot whose decoded config does not match its source bytes", () => {
    const sourceConfig = { ...defaultConfig, sessionRehomeRoots: ["fixtures"] };
    const globalConfig = {
      ...presentConfigSnapshot(sourceConfig),
      config: { ...sourceConfig, sessionRehomeRoots: ["vendor"] },
    };

    expect(() =>
      planManagedConfig({
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig },
        previousConfigFile: missingPrevious,
      }),
    ).toThrow("source bytes");
  });

  it("rejects first-project selection in global scope", () => {
    expect(() =>
      planManagedConfig({
        scope: "global",
        selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
        previousConfigFile: missingPrevious,
      }),
    ).toThrow("project");
  });

  it("rejects a first project selection when a target config already exists", () => {
    expect(() =>
      planManagedConfig({
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
        previousConfigFile: { _tag: "priorFile", bytes: textEncoder.encode("original config") },
      }),
    ).toThrow("missing target managed config");
  });

  it("keeps later global and project selections independent", () => {
    const global = planManagedConfig(selectedRequest("global", { ...defaultConfig, sessionRehomeRoots: ["vendor"] }));
    const project = planManagedConfig(
      selectedRequest("project", { ...defaultConfig, sessionRehomeRoots: ["generated"] }),
    );

    expect(global.config.sessionRehomeRoots).toEqual(["vendor"]);
    expect(project.config.sessionRehomeRoots).toEqual(["generated"]);
    expect(global.managedConfigWrite).not.toEqual(project.managedConfigWrite);
  });

  it("preserves exact prior config bytes and correlates desired bytes with their hash", () => {
    const priorBytes = textEncoder.encode('{  "user": "format"  }\n');
    const plan = planManagedConfig({
      scope: "project",
      selection: { _tag: "selected", config: defaultConfig },
      previousConfigFile: { _tag: "priorFile", bytes: priorBytes },
    });

    expect(wholeFileOwnership(plan).previous).toEqual({ _tag: "priorFile", bytes: priorBytes });
    expect(wholeFileOwnership(plan).installedHash).toBe(hashBytes(plan.managedConfigWrite.bytes));
  });

  it("strictly rejects unknown request properties", () => {
    expect(() =>
      planManagedConfig({
        ...selectedRequest("project", defaultConfig),
        unexpected: true,
      }),
    ).toThrow("Unrecognized key");
  });

  it("rejects managed plan data whose config and write drift apart", () => {
    const plan = planManagedConfig(selectedRequest("project", defaultConfig));
    const bytes = textEncoder.encode(
      `${JSON.stringify({ ...defaultConfig, sessionRehomeRoots: ["different"] }, null, 2)}\n`,
    );

    expect(() =>
      assertManagedConfigPlan({
        ...plan,
        managedConfigWrite: {
          ...plan.managedConfigWrite,
          file: {
            ...plan.managedConfigWrite.file,
            ownership: { ...wholeFileOwnership(plan), installedHash: hashBytes(bytes) },
          },
          bytes,
        },
      }),
    ).toThrow("must encode");
  });
});
