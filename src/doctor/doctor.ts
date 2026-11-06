import { FileSystem, Path } from "@effect/platform";
import { Effect, Either, Schema, ParseResult as SchemaParseIssue } from "effect";

import {
  type AgentEvidence,
  agentCatalog,
  agentEvidenceSchema,
  agentIdSchema,
  detectAgents,
} from "../catalog/agentCatalog.js";
import {
  addDependencies,
  type FeatureDefinition,
  featureCatalog,
  featureDefinitionSchema,
  featureIdSchema,
} from "../catalog/featureCatalog.js";
import { managedConfigPath, readConfigFile } from "../config/configFile.js";
import { configSchema } from "../config/configSchema.js";
import { hostPlatformSchema } from "../config/hostScan.js";
import { installationDestinationSchema, receiptPath, statePath } from "../install/installPaths.js";
import { preparedPackageSchema } from "../install/installRequest.js";
import { relativePathSchema } from "../install/ownership.js";
import { type Receipt, readReceipt, receiptSchema, scopeSchema, versionSchema } from "../install/receipt.js";

export const healthRequestSchema = Schema.Struct({
  destination: installationDestinationSchema,
  preparedPackage: preparedPackageSchema,
  platform: hostPlatformSchema,
  agentEvidence: agentEvidenceSchema,
}).annotations({
  description: "Complete read-only doctor request decoded before filesystem inspection.",
});

type HealthRequest = Schema.Schema.Type<typeof healthRequestSchema>;

const configHealthSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("present", {
    config: configSchema.annotations({
      description: "Strict complete managed configuration decoded from disk.",
    }),
  }),
).annotations({
  description: "Managed configuration state observed without changing it.",
});

const installationHealthSchema = Schema.Union(
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("present", {
    version: receiptSchema.fields.version.annotations({
      description: "Installed package version recorded by the receipt.",
    }),
    features: receiptSchema.fields.features.annotations({
      description: "Dependency-resolved installed features recorded by the receipt.",
    }),
  }),
).annotations({
  description: "Installed state derived only from a strict ownership receipt.",
});

const preparedRuntimeStatusSchema = Schema.Union(
  Schema.TaggedStruct("notRequired", {}),
  Schema.TaggedStruct("present", {
    path: relativePathSchema.annotations({
      description: "Verified prepared runtime entrypoint relative to the prepared package root.",
    }),
  }),
  Schema.TaggedStruct("missing", {
    path: relativePathSchema.annotations({
      description: "Expected prepared runtime entrypoint missing from the prepared package.",
    }),
  }),
).annotations({
  description: "Catalog-derived prepared runtime availability for one installed feature.",
});

const featureHealthSchema = Schema.Struct({
  id: featureIdSchema,
  title: Schema.NonEmptyTrimmedString.annotations({
    description: "Catalog title for the installed feature.",
  }),
  platform: featureDefinitionSchema.fields.platform,
  platformAvailable: Schema.Boolean.annotations({
    description: "Whether the observed host satisfies the catalog platform requirement.",
  }),
  preparedRuntime: preparedRuntimeStatusSchema,
}).annotations({
  description: "Read-only catalog, host, and prepared-runtime diagnosis for one installed feature.",
});

const agentHealthSchema = Schema.Struct({
  id: agentIdSchema,
  displayName: Schema.NonEmptyTrimmedString.annotations({
    description: "Catalog display name for the diagnosed agent.",
  }),
  detected: Schema.Boolean.annotations({
    description: "Whether caller-observed evidence matches this catalog agent.",
  }),
  managed: Schema.Boolean.annotations({
    description: "Whether the strict receipt owns a file for this agent.",
  }),
  nativeHookSupport: Schema.Literal("verified", "unsupported").annotations({
    description: "Whether this agent has a verified native lifecycle-hook adapter.",
  }),
}).annotations({
  description: "Receipt ownership compared with non-authoritative detection evidence.",
});

const autorunWatcherSchema = Schema.Struct({
  sessionId: Schema.NonEmptyTrimmedString.annotations({
    description: "Claude session id whose detached autorun watcher was observed.",
  }),
  pid: Schema.Number.pipe(Schema.int(), Schema.positive()).annotations({
    description: "Live process id recorded in the watcher pid lockfile.",
  }),
}).annotations({
  description: "One live autorun watcher observed under the install root's state/autorun folder.",
});

const discrepancySchema = Schema.Union(
  Schema.TaggedStruct("receiptScopeMismatch", {
    requestedScope: scopeSchema,
    receiptScope: scopeSchema,
  }),
  Schema.TaggedStruct("packageVersionMismatch", {
    installedVersion: versionSchema,
    preparedVersion: versionSchema,
  }),
  Schema.TaggedStruct("missingManagedConfig", {}),
  Schema.TaggedStruct("unsupportedFeaturePlatform", {
    featureId: featureIdSchema,
    platform: featureDefinitionSchema.fields.platform,
  }),
  Schema.TaggedStruct("missingPreparedRuntime", {
    featureId: featureIdSchema,
    path: relativePathSchema,
  }),
  Schema.TaggedStruct("detectedAgentNotManaged", {
    agentId: agentIdSchema,
  }),
  Schema.TaggedStruct("managedAgentNotDetected", {
    agentId: agentIdSchema,
  }),
  Schema.TaggedStruct("missingFeatureDependency", {
    featureId: featureIdSchema,
  }),
).annotations({
  description: "Read-only discrepancy that never grants repair or deletion authority.",
});

export type Discrepancy = Schema.Schema.Type<typeof discrepancySchema>;

const healthReportSchema = Schema.Struct({
  scope: scopeSchema.annotations({
    description: "Installation scope inspected by this report.",
  }),
  config: configHealthSchema,
  installation: installationHealthSchema,
  features: Schema.Array(featureHealthSchema).annotations({
    description: "Installed features diagnosed in catalog order.",
  }),
  agents: Schema.Array(agentHealthSchema).annotations({
    description: "All catalog agents compared with receipt and detection evidence.",
  }),
  watchers: Schema.Array(autorunWatcherSchema).annotations({
    description: "Live autorun watchers observed under the destination's state/autorun folder.",
  }),
  discrepancies: Schema.Array(discrepancySchema).annotations({
    description: "Deterministic diagnostic differences observed without authorizing mutation.",
  }),
}).annotations({
  description: "Complete read-only agent-setup health report.",
});

export type HealthReport = Schema.Schema.Type<typeof healthReportSchema>;

export class HealthCheckError extends Schema.TaggedError<HealthCheckError>()("HealthCheckError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable request or read-only inspection failure.",
  }),
}) {
  get message(): string {
    return `Cannot inspect agent-setup: ${this.issue}`;
  }
}

const decodeHealthRequest = (input: unknown) =>
  Schema.decodeUnknown(healthRequestSchema, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError((error) => new HealthCheckError({ issue: SchemaParseIssue.TreeFormatter.formatErrorSync(error) })),
  );

const validateFeatureHealth = Schema.validate(featureHealthSchema, { onExcessProperty: "error" });

const platformAvailable = (feature: FeatureDefinition, platform: HealthRequest["platform"]): boolean => {
  if (feature.platform === "any") {
    return true;
  }

  if (platform.operatingSystem !== "darwin") {
    return false;
  }

  return feature.platform === "macos" || platform.ghosttyAvailable;
};

const preparedRuntimeStatus = (request: { readonly feature: FeatureDefinition; readonly packageRoot: string }) =>
  Effect.gen(function* () {
    if (request.feature.runtime._tag === "none") {
      return { _tag: "notRequired" as const };
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entrypoint = `${request.feature.runtime.sourceEntrypoint.slice(0, -3)}.js`;
    const relativePath = `hooks/${request.feature.sourceDirectory}/${entrypoint}`;
    const present = yield* fileSystem.exists(path.join(request.packageRoot, relativePath));
    return { _tag: present ? ("present" as const) : ("missing" as const), path: relativePath };
  });

const checkFeatureHealth = (request: HealthRequest, receipt: Receipt) => {
  const installedFeatureIds = new Set(receipt.features);

  return Effect.forEach(
    featureCatalog.filter((feature) => installedFeatureIds.has(feature.id)),
    (feature) =>
      Effect.gen(function* () {
        return yield* validateFeatureHealth({
          id: feature.id,
          title: feature.title,
          platform: feature.platform,
          platformAvailable: platformAvailable(feature, request.platform),
          preparedRuntime: yield* preparedRuntimeStatus({ feature, packageRoot: request.preparedPackage.root }),
        });
      }),
  );
};

// The receipt lists what is installed; a dependency it lacks is reported, and install or update adds it.
const findMissingDependencies = (receipt: Receipt): Array<Discrepancy> => {
  const recordedIds = new Set<string>(receipt.features);
  const requiredResult = addDependencies(receipt.features);
  const requiredIds = Either.getOrThrow(requiredResult);

  return requiredIds
    .filter((featureId) => !recordedIds.has(featureId))
    .map((featureId) => ({ _tag: "missingFeatureDependency" as const, featureId }));
};

const checkAgentHealth = (evidence: AgentEvidence, receipt: Receipt | undefined) => {
  const managedIds = new Set(
    receipt?.ownedFiles.flatMap((file) => (file.owner._tag === "agent" ? file.owner.agentIds : [])) || [],
  );
  const detectedAgents = new Map(detectAgents(evidence).map((agent) => [agent.id, agent.installed]));

  return agentCatalog.map((agent) => ({
    id: agent.id,
    displayName: agent.displayName,
    detected: detectedAgents.get(agent.id) === true,
    managed: managedIds.has(agent.id),
    nativeHookSupport: agent.nativeHooks._tag === "unsupported" ? "unsupported" : "verified",
  }));
};

const toHealthCheckError = (error: unknown): HealthCheckError =>
  error instanceof HealthCheckError
    ? error
    : new HealthCheckError({ issue: error instanceof Error ? error.message : String(error) });

const processAlive = (pid: number): boolean => {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const findAutorunWatchers = (request: HealthRequest) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const autorunStateDir = path.join(request.destination.root, statePath, "autorun");
    if (!(yield* fileSystem.exists(autorunStateDir))) {
      return [];
    }

    const pidFiles = (yield* fileSystem.readDirectory(autorunStateDir)).filter((name) => name.endsWith(".pid"));
    const watchers = yield* Effect.forEach(pidFiles, (name) =>
      fileSystem.readFileString(path.join(autorunStateDir, name)).pipe(
        Effect.catchAll(() => Effect.succeed("")),
        Effect.map((pidText) => ({
          sessionId: name.slice(0, -".pid".length),
          pid: Number.parseInt(pidText.trim(), 10),
        })),
      ),
    );
    return watchers.filter((watcher) => Number.isFinite(watcher.pid) && processAlive(watcher.pid));
  });

// Compares the strict receipt and config with catalog-derived host observations, without writing anything.
export const checkHealth = (input: unknown) =>
  Effect.gen(function* () {
    const request = yield* decodeHealthRequest(input);
    const path = yield* Path.Path;
    const configSnapshot = yield* readConfigFile(path.join(request.destination.root, managedConfigPath));
    const receiptSnapshot = yield* readReceipt(path.join(request.destination.root, receiptPath));
    const receipt = receiptSnapshot._tag === "present" ? receiptSnapshot.receipt : undefined;
    const featureDiagnostics = receipt === undefined ? [] : yield* checkFeatureHealth(request, receipt);
    const agentDiagnostics = checkAgentHealth(request.agentEvidence, receipt);
    const autorunWatchers = yield* findAutorunWatchers(request);

    // Discrepancies are report data only; they never authorize a repair.
    const discrepancies: Array<Discrepancy> = [];
    if (receipt !== undefined) {
      if (receipt.scope !== request.destination._tag) {
        discrepancies.push({
          _tag: "receiptScopeMismatch",
          requestedScope: request.destination._tag,
          receiptScope: receipt.scope,
        });
      }

      if (receipt.version !== request.preparedPackage.version) {
        discrepancies.push({
          _tag: "packageVersionMismatch",
          installedVersion: receipt.version,
          preparedVersion: request.preparedPackage.version,
        });
      }

      if (configSnapshot._tag === "missing") {
        discrepancies.push({ _tag: "missingManagedConfig" });
      }

      const missingDependencies = findMissingDependencies(receipt);
      discrepancies.push(...missingDependencies);
    }

    for (const feature of featureDiagnostics) {
      if (!feature.platformAvailable) {
        discrepancies.push({ _tag: "unsupportedFeaturePlatform", featureId: feature.id, platform: feature.platform });
      }

      if (feature.preparedRuntime._tag === "missing") {
        discrepancies.push({
          _tag: "missingPreparedRuntime",
          featureId: feature.id,
          path: feature.preparedRuntime.path,
        });
      }
    }

    for (const agent of agentDiagnostics) {
      if (agent.detected && !agent.managed) {
        discrepancies.push({ _tag: "detectedAgentNotManaged", agentId: agent.id });
      } else if (agent.managed && !agent.detected) {
        discrepancies.push({ _tag: "managedAgentNotDetected", agentId: agent.id });
      }
    }

    return yield* Schema.validate(healthReportSchema, { onExcessProperty: "error" })({
      scope: request.destination._tag,
      config:
        configSnapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "present", config: configSnapshot.config },
      installation:
        receipt === undefined
          ? { _tag: "missing" }
          : { _tag: "present", version: receipt.version, features: receipt.features },
      features: featureDiagnostics,
      agents: agentDiagnostics,
      watchers: autorunWatchers,
      discrepancies,
    });
  }).pipe(Effect.mapError(toHealthCheckError));
