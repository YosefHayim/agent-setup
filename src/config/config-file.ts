import { FileSystem } from "@effect/platform";
import { Effect, Either, Option, Schema, ParseResult as SchemaParseIssue } from "effect";

import { bytesEqual, hashBytes, isNotFound } from "../install/file-bytes.js";
import { findDuplicateJsonKey } from "../install/find-duplicate-json-key.js";
import { type PreviousFileValue, previousFileValueSchema } from "../install/ownership.js";
import { type WriteOperation, writeOperationSchema } from "../install/plan.js";
import { scopeSchema } from "../install/receipt.js";
import { type Config, configSchema, defaultConfig } from "./config-schema.js";

export const managedConfigPath = ".claude/agent-setup/config.json";

const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const textEncoder = new TextEncoder();

const formatIssue = SchemaParseIssue.TreeFormatter.formatErrorSync;

export class ConfigFileParseError extends Schema.TaggedError<ConfigFileParseError>()("ConfigFileParseError", {
  configPath: Schema.NonEmptyString.annotations({
    description: "Managed configuration file that could not be parsed as JSON.",
  }),
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable JSON parsing issue reported by Effect Schema.",
  }),
}) {
  get message(): string {
    return `Managed config at ${this.configPath} is not valid JSON: ${this.issue}. Fix or remove it, then retry.`;
  }
}

export class ConfigFileSchemaError extends Schema.TaggedError<ConfigFileSchemaError>()("ConfigFileSchemaError", {
  configPath: Schema.NonEmptyString.annotations({
    description: "Managed configuration file whose decoded value violated the schema.",
  }),
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable managed configuration issue reported by Effect Schema.",
  }),
}) {
  get message(): string {
    return `Managed config at ${this.configPath} is invalid: ${this.issue}. Fix or remove it, then retry.`;
  }
}

const decodeJson = Schema.decodeUnknownEither(Schema.parseJson(), { onExcessProperty: "error" });

const decodeConfigValue = Schema.decodeUnknownEither(configSchema, { onExcessProperty: "error" });

// Lossless at every trust boundary: no replacement characters, no BOM normalization, no collapsed duplicate keys.
const decodeConfigFileBytes = (input: {
  readonly bytes: Uint8Array;
  readonly configPath: string;
}): Either.Either<Config, ConfigFileParseError | ConfigFileSchemaError> => {
  const parseError = (issue: string) => new ConfigFileParseError({ configPath: input.configPath, issue });
  const text = Either.try({
    try: () => textDecoder.decode(input.bytes),
    catch: (error) =>
      parseError(`file bytes are not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`),
  });
  if (Either.isLeft(text)) {
    return Either.left(text.left);
  }

  if (text.right.startsWith("\uFEFF")) {
    return Either.left(parseError("file must not start with a UTF-8 byte-order mark"));
  }

  const json = Either.mapLeft(decodeJson(text.right), (error) => parseError(formatIssue(error)));
  if (Either.isLeft(json)) {
    return Either.left(json.left);
  }

  const duplicateKey = findDuplicateJsonKey(text.right);
  if (duplicateKey !== undefined) {
    return Either.left(parseError(`duplicate JSON property ${JSON.stringify(duplicateKey)}`));
  }

  return Either.mapLeft(
    decodeConfigValue(json.right),
    (error) => new ConfigFileSchemaError({ configPath: input.configPath, issue: formatIssue(error) }),
  );
};

const managedConfigsEqual = Schema.equivalence(configSchema);

const missingConfigFileSnapshotSchema = Schema.TaggedStruct("missing", {}).annotations({
  description: "Managed configuration file is absent.",
});

const presentConfigFileSnapshotSchema = Schema.TaggedStruct("present", {
  bytes: Schema.Uint8ArrayFromSelf.annotations({
    description: "Exact managed configuration bytes read once from disk.",
  }),
  config: configSchema.annotations({
    description: "Complete strict configuration decoded from the same bytes.",
  }),
})
  .pipe(
    Schema.filter((snapshot) => {
      const decoded = decodeConfigFileBytes({ bytes: snapshot.bytes, configPath: "managed configuration snapshot" });

      return Either.isRight(decoded) && managedConfigsEqual(decoded.right, snapshot.config)
        ? undefined
        : { path: ["config"], message: "Decoded managed configuration must exactly match its source bytes." };
    }),
  )
  .annotations({
    description: "Exact managed configuration bytes and their decoded value.",
  });

const configFileSnapshotSchema = Schema.Union(
  missingConfigFileSnapshotSchema,
  presentConfigFileSnapshotSchema,
).annotations({
  description: "Missing or present managed configuration captured by one filesystem read.",
});

export type ConfigFileSnapshot = Schema.Schema.Type<typeof configFileSnapshotSchema>;

export const readConfigFile = (configPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem.readFile(configPath).pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () => Effect.succeed(Option.none())),
    );
    if (Option.isNone(contents)) {
      return missingConfigFileSnapshotSchema.make();
    }

    const decoded = decodeConfigFileBytes({ bytes: contents.value, configPath });
    if (Either.isLeft(decoded)) {
      return yield* decoded.left;
    }

    return presentConfigFileSnapshotSchema.make({ _tag: "present", bytes: contents.value, config: decoded.right });
  });

const managedConfigJsonSchema = Schema.parseJson(configSchema, { space: 2 });

export class ManagedConfigPlanError extends Schema.TaggedError<ManagedConfigPlanError>()("ManagedConfigPlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable request or generated-plan validation issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan managed configuration: ${this.issue}`;
  }
}

const renderManagedConfigBytes = (config: Config): Uint8Array =>
  textEncoder.encode(`${Schema.encodeSync(managedConfigJsonSchema)(config)}\n`);

const configSelectionSchema = Schema.Union(
  Schema.TaggedStruct("selected", {
    config: configSchema.annotations({
      description: "Complete validated configuration selected for this scope.",
    }),
  }),
  Schema.TaggedStruct("firstProjectInstall", {
    globalConfig: configFileSnapshotSchema.annotations({
      description:
        "Exact validated global snapshot copied once, or a missing snapshot when schema defaults should be used.",
    }),
  }),
).annotations({
  description: "Tagged source of the complete managed configuration without behavior flags.",
});

const managedConfigRequestFieldsSchema = Schema.Struct({
  scope: scopeSchema.annotations({
    description: "Installation scope receiving the managed configuration.",
  }),
  selection: configSelectionSchema,
  previousConfigFile: Schema.typeSchema(previousFileValueSchema).annotations({
    description: "Exact original managed-config state retained for whole-file restoration.",
  }),
});

const firstProjectInstallIssues = (request: Schema.Schema.Type<typeof managedConfigRequestFieldsSchema>) => {
  if (request.selection._tag !== "firstProjectInstall") {
    return [];
  }

  return [
    request.scope === "project"
      ? undefined
      : { path: ["selection", "_tag"], message: "A first project install requires project scope." },
    request.previousConfigFile._tag === "missing"
      ? undefined
      : { path: ["previousConfigFile"], message: "A first project install requires a missing target managed config." },
  ];
};

export const managedConfigRequestSchema = managedConfigRequestFieldsSchema.pipe(
  Schema.filter(firstProjectInstallIssues),
);

export type ManagedConfigRequest = Schema.Schema.Type<typeof managedConfigRequestSchema>;

const managedConfigWriteSchema = writeOperationSchema.pipe(
  Schema.filter((operation) => [
    operation.file.path === managedConfigPath
      ? undefined
      : { path: ["file", "path"], message: `Managed configuration writes must target ${managedConfigPath}.` },
    operation.file.kind._tag === "managedConfig"
      ? undefined
      : { path: ["file", "kind"], message: "Managed configuration writes require the managedConfig file kind." },
    operation.file.ownership._tag === "wholeFile" &&
    operation.file.ownership.installedHash !== hashBytes(operation.bytes)
      ? {
          path: ["file", "ownership", "installedHash"],
          message: "Managed-config ownership hash must match its exact desired bytes.",
        }
      : undefined,
  ]),
);

const managedConfigPlanFieldsSchema = Schema.Struct({
  config: configSchema.annotations({
    description: "Complete configuration built by this plan.",
  }),
  managedConfigWrite: managedConfigWriteSchema.annotations({
    description: "Exact managed-config write published by the complete plan.",
  }),
});

export const managedConfigPlanSchema = managedConfigPlanFieldsSchema.pipe(
  Schema.filter((plan) =>
    bytesEqual(plan.managedConfigWrite.bytes, renderManagedConfigBytes(plan.config))
      ? undefined
      : {
          path: ["managedConfigWrite", "bytes"],
          message: "Managed-config bytes must encode the returned complete configuration.",
        },
  ),
);

export type ManagedConfigPlan = Schema.Schema.Type<typeof managedConfigPlanSchema>;

const toPlanError = (error: SchemaParseIssue.ParseError) => new ManagedConfigPlanError({ issue: formatIssue(error) });

const decodeManagedConfigRequest = (input: unknown) =>
  Either.mapLeft(
    Schema.decodeUnknownEither(managedConfigRequestSchema, { onExcessProperty: "error" })(input),
    toPlanError,
  );

const validateManagedConfigPlan = (input: unknown) =>
  Either.mapLeft(Schema.validateEither(managedConfigPlanSchema, { onExcessProperty: "error" })(input), toPlanError);

const createManagedConfigWrite = (config: Config, previous: PreviousFileValue): WriteOperation => {
  const bytes = renderManagedConfigBytes(config);

  return {
    _tag: "write",
    file: {
      path: managedConfigPath,
      kind: { _tag: "managedConfig" },
      owner: { _tag: "application" },
      ownership: { _tag: "wholeFile", installedHash: hashBytes(bytes), previous },
    },
    bytes,
  };
};

const resolveSelectedConfig = (request: ManagedConfigRequest): Config => {
  switch (request.selection._tag) {
    case "selected":
      return request.selection.config;
    case "firstProjectInstall":
      return request.selection.globalConfig._tag === "present" ? request.selection.globalConfig.config : defaultConfig;
  }
};

// Plans one managed config without I/O: decode fully, resolve one source, then validate the correlated write.
export const planManagedConfig = (input: unknown): Either.Either<ManagedConfigPlan, ManagedConfigPlanError> => {
  const request = decodeManagedConfigRequest(input);
  if (Either.isLeft(request)) {
    return Either.left(request.left);
  }

  const config = resolveSelectedConfig(request.right);

  return validateManagedConfigPlan({
    config,
    managedConfigWrite: createManagedConfigWrite(config, request.right.previousConfigFile),
  });
};
