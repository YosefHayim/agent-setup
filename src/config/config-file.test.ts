import { createHash } from "node:crypto";

import { FileSystem, Path } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { Effect, Either, Schema } from "effect";

import {
  ConfigFileParseError,
  ConfigFileSchemaError,
  type ManagedConfigPlan,
  ManagedConfigPlanError,
  managedConfigPath,
  managedConfigPlanSchema,
  managedConfigRequestSchema,
  planManagedConfig,
  readConfigFile,
} from "./config-file.js";
import { type Config, configJsonSchema, defaultConfig } from "./config-schema.js";

const textEncoder = new TextEncoder();

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const writeConfigContents = (contents: Uint8Array | string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-config-file-" });
    const configPath = path.join(root, "config.json");
    yield* fileSystem.writeFile(configPath, typeof contents === "string" ? textEncoder.encode(contents) : contents);
    return configPath;
  });

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

layer(NodeContext.layer)("readConfigFile", (it) => {
  it.scoped("returns a tagged missing snapshot when the managed config is absent", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-config-file-missing-" });

      expect(yield* readConfigFile(path.join(root, "config.json"))).toEqual({ _tag: "missing" });
    }),
  );

  it.scoped("returns exact file bytes with one strict complete managed config", () =>
    Effect.gen(function* () {
      const bytes = textEncoder.encode(`\n${yield* Schema.encode(configJsonSchema)(defaultConfig)}\n`);

      const snapshot = yield* readConfigFile(yield* writeConfigContents(bytes));

      expect(snapshot._tag === "present" && [...snapshot.bytes]).toEqual([...bytes]);
      expect(snapshot._tag === "present" && snapshot.config).toEqual(defaultConfig);
    }),
  );

  it.scoped("applies schema defaults to an incomplete config", () =>
    Effect.gen(function* () {
      const snapshot = yield* readConfigFile(yield* writeConfigContents(JSON.stringify({ debugLogs: true })));

      expect(snapshot._tag === "present" && snapshot.config).toEqual({ ...defaultConfig, debugLogs: true });
    }),
  );

  it.scoped.each([
    { name: "malformed JSON", contents: "{not-json", error: ConfigFileParseError, mentions: "config.json" },
    {
      name: "an excess property",
      contents: JSON.stringify({ ...defaultConfig, unexpected: true }),
      error: ConfigFileSchemaError,
      mentions: "unexpected",
    },
    {
      name: "an empty root folder",
      contents: JSON.stringify({ ...defaultConfig, sessionRehomeRoots: [""] }),
      error: ConfigFileSchemaError,
      mentions: "sessionRehomeRoots",
    },
    { name: "non-UTF-8 bytes", contents: bytesWithInvalidUtf8(), error: ConfigFileParseError, mentions: "UTF-8" },
    {
      name: "duplicate properties that JSON parsing would collapse",
      contents: JSON.stringify(defaultConfig).replace(
        `"debugLogs":${String(defaultConfig.debugLogs)}`,
        '"\\u0064ebugLogs":false,"debugLogs":true',
      ),
      error: ConfigFileParseError,
      mentions: 'duplicate JSON property "debugLogs"',
    },
    {
      name: "a UTF-8 byte-order mark",
      contents: new Uint8Array([0xef, 0xbb, 0xbf, ...textEncoder.encode(JSON.stringify(defaultConfig))]),
      error: ConfigFileParseError,
      mentions: "byte-order mark",
    },
  ])("rejects $name", ({ contents, error, mentions }) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(readConfigFile(yield* writeConfigContents(contents)));

      expect(failure).toBeInstanceOf(error);
      expect(failure.message).toContain(mentions);
    }),
  );

  it.scoped("preserves non-missing filesystem errors", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-config-file-read-error-" });

      expect((yield* Effect.flip(readConfigFile(root)))._tag).toBe("SystemError");
    }),
  );
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

const unwrap = (plan: Either.Either<ManagedConfigPlan, ManagedConfigPlanError>): ManagedConfigPlan =>
  Either.getOrThrowWith(plan, (error) => new Error(error.message));

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

const expectPlanFailure = (request: unknown, mentions: string) => {
  const plan = planManagedConfig(request);

  expect(Either.isLeft(plan)).toBe(true);
  if (Either.isLeft(plan)) {
    expect(plan.left).toBeInstanceOf(ManagedConfigPlanError);
    expect(plan.left.message).toContain(mentions);
  }
};

describe("planManagedConfig", () => {
  it("copies the global snapshot once for a first project install and otherwise uses defaults", () => {
    const globalConfig = { ...defaultConfig, sessionRehomeRoots: ["fixtures"], debugLogs: true };
    const copied = unwrap(
      planManagedConfig({
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig: presentConfigSnapshot(globalConfig) },
        previousConfigFile: missingPrevious,
      }),
    );
    const defaulted = unwrap(
      planManagedConfig({
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
        previousConfigFile: missingPrevious,
      }),
    );

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

    expectPlanFailure(
      {
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig },
        previousConfigFile: missingPrevious,
      },
      "source bytes",
    );
  });

  it("rejects first-project selection in global scope", () => {
    expectPlanFailure(
      {
        scope: "global",
        selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
        previousConfigFile: missingPrevious,
      },
      "project",
    );
  });

  it("rejects a first project selection when a target config already exists", () => {
    expectPlanFailure(
      {
        scope: "project",
        selection: { _tag: "firstProjectInstall", globalConfig: { _tag: "missing" } },
        previousConfigFile: { _tag: "priorFile", bytes: textEncoder.encode("original config") },
      },
      "missing target managed config",
    );
  });

  it("keeps later global and project selections independent", () => {
    const global = unwrap(
      planManagedConfig(selectedRequest("global", { ...defaultConfig, sessionRehomeRoots: ["vendor"] })),
    );
    const project = unwrap(
      planManagedConfig(selectedRequest("project", { ...defaultConfig, sessionRehomeRoots: ["generated"] })),
    );

    expect(global.config.sessionRehomeRoots).toEqual(["vendor"]);
    expect(project.config.sessionRehomeRoots).toEqual(["generated"]);
    expect(global.managedConfigWrite).not.toEqual(project.managedConfigWrite);
  });

  it("preserves exact prior config bytes and correlates desired bytes with their hash", () => {
    const priorBytes = textEncoder.encode('{  "user": "format"  }\n');
    const plan = unwrap(
      planManagedConfig({
        scope: "project",
        selection: { _tag: "selected", config: defaultConfig },
        previousConfigFile: { _tag: "priorFile", bytes: priorBytes },
      }),
    );

    expect(wholeFileOwnership(plan).previous).toEqual({ _tag: "priorFile", bytes: priorBytes });
    expect(wholeFileOwnership(plan).installedHash).toBe(hashBytes(plan.managedConfigWrite.bytes));
  });

  it("strictly rejects unknown request properties", () => {
    const decoded = Schema.decodeUnknownEither(managedConfigRequestSchema, { onExcessProperty: "error" })({
      ...selectedRequest("project", defaultConfig),
      unexpected: true,
    });

    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects managed plan data whose config and write drift apart", () => {
    const plan = unwrap(planManagedConfig(selectedRequest("project", defaultConfig)));
    const bytes = textEncoder.encode(
      `${JSON.stringify({ ...defaultConfig, sessionRehomeRoots: ["different"] }, null, 2)}\n`,
    );

    const decoded = Schema.validateEither(managedConfigPlanSchema, { onExcessProperty: "error" })({
      ...plan,
      managedConfigWrite: {
        ...plan.managedConfigWrite,
        file: {
          ...plan.managedConfigWrite.file,
          ownership: { ...wholeFileOwnership(plan), installedHash: hashBytes(bytes) },
        },
        bytes,
      },
    });

    expect(Either.isLeft(decoded)).toBe(true);
  });
});
