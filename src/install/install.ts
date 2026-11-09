import { FileSystem, Path } from "@effect/platform";
import { Effect, Either, Schema, ParseResult as SchemaParseIssue } from "effect";

import { type AgentDefinition, agentCatalog, detectAgents } from "../catalog/agent-catalog.js";
import { addDependencies, defaultFeatureIds, type FeatureId, featureCatalog } from "../catalog/feature-catalog.js";
import {
  type ConfigFileSnapshot,
  type ManagedConfigPlan,
  type ManagedConfigRequest,
  managedConfigPath,
  planManagedConfig,
  readConfigFile,
} from "../config/config-file.js";
import { defaultConfig } from "../config/config-schema.js";
import { createAgentWrites } from "./agent-files.js";
import { applyPlan } from "./apply-plan.js";
import { hashBytes } from "./file-bytes.js";
import { type DecodedSettings, decodeSettings, desiredHookGroups, planSettings } from "./hook-settings.js";
import {
  applicationOwner,
  checkFileChange,
  expectedCurrent,
  type FileSnapshot,
  previousFileValue,
  previousReceiptFile,
  previousWholeFile,
  readFileSnapshot,
} from "./host-files.js";
import { hooksPath, receiptPath, settingsPath } from "./install-paths.js";
import {
  InstallError,
  type InstallRequest,
  type InstallSummary,
  installRequestSchema,
  toInstallError,
} from "./install-request.js";
import type { PreviousFileValue } from "./ownership.js";
import { createHookWrites, readPreparedSkills } from "./package-files.js";
import type { FileChange, ReceiptTarget } from "./plan.js";
import { planInstall } from "./plan-changes.js";
import { type Receipt, type ReceiptSnapshot, readReceipt, receiptJsonSchema } from "./receipt.js";
import { planStaleRestorations } from "./restore.js";

const receiptEqual = (left: Receipt, right: Receipt): boolean =>
  Schema.encodeSync(receiptJsonSchema)(left) === Schema.encodeSync(receiptJsonSchema)(right);

const configSnapshotFile = (snapshot: ConfigFileSnapshot): FileSnapshot =>
  snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", bytes: snapshot.bytes };

const decodeStrictly =
  <Decoded, Encoded>(schema: Schema.Schema<Decoded, Encoded>) =>
  (input: unknown) =>
    Schema.decodeUnknown(schema, { onExcessProperty: "error" })(input).pipe(
      Effect.mapError((error) => new InstallError({ issue: SchemaParseIssue.TreeFormatter.formatErrorSync(error) })),
    );

const resolveFeatures = (request: InstallRequest): Either.Either<ReadonlyArray<FeatureId>, InstallError> => {
  const ids = request.features._tag === "defaults" ? defaultFeatureIds : request.features.ids;

  const resolved = addDependencies(ids);
  const isFeatureUnknown = resolved.status === "unknown";
  if (isFeatureUnknown) {
    return Either.left(new InstallError({ issue: `Unknown feature ${resolved.featureId}.` }));
  }

  return Either.right(resolved.featureIds);
};

const resolveSelectedAgents = (
  ids: ReadonlyArray<string>,
): Either.Either<ReadonlyArray<AgentDefinition>, InstallError> => {
  const unknownId = ids.find((id) => !agentCatalog.some((agent) => agent.id === id));
  if (unknownId !== undefined) {
    return Either.left(new InstallError({ issue: `Unknown agent: ${unknownId}` }));
  }

  if (ids.length !== new Set(ids).size) {
    return Either.left(new InstallError({ issue: "Agent selection contains duplicate IDs." }));
  }

  return Either.right(agentCatalog.filter((agent) => ids.includes(agent.id)));
};

const resolveAgents = (request: InstallRequest): Either.Either<ReadonlyArray<AgentDefinition>, InstallError> => {
  if (request.agents._tag === "selected") {
    return resolveSelectedAgents(request.agents.ids);
  }

  return resolveSelectedAgents(
    detectAgents(request.agents.evidence).flatMap((agent) => (agent.installed ? [agent.id] : [])),
  );
};

const receiptTarget: ReceiptTarget = {
  path: receiptPath,
  kind: { _tag: "receipt" },
  owner: applicationOwner,
};

const automaticConfigSelection = (input: {
  request: InstallRequest;
  target: ConfigFileSnapshot;
  global: ConfigFileSnapshot | undefined;
}): ManagedConfigRequest["selection"] => {
  if (input.target._tag === "present") {
    return { _tag: "selected", config: input.target.config };
  }

  if (input.request.destination._tag === "project") {
    return {
      _tag: "firstProjectInstall",
      globalConfig: input.global === undefined ? { _tag: "missing" } : input.global,
    };
  }

  return { _tag: "selected", config: defaultConfig };
};

type ManagedConfigInspection = {
  readonly file: FileSnapshot;
  readonly selection: ManagedConfigRequest["selection"];
};

// Decode config.json only when the automatic selection reuses or inherits it; an explicit or reset
// configuration needs just its bytes, so a file the schema no longer accepts cannot block replacing it.
const inspectManagedConfig = (request: InstallRequest) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const configPath = path.join(request.destination.root, managedConfigPath);
    switch (request.configuration._tag) {
      case "selected":
        return {
          file: yield* readFileSnapshot(configPath),
          selection: { _tag: "selected", config: request.configuration.config },
        } satisfies ManagedConfigInspection;
      case "reset":
        return {
          file: yield* readFileSnapshot(configPath),
          selection: { _tag: "selected", config: defaultConfig },
        } satisfies ManagedConfigInspection;
      case "automatic": {
        const target = yield* Effect.tryPromise({ try: () => readConfigFile(configPath), catch: (error) => error });
        const global =
          request.destination._tag === "project" && target._tag === "missing"
            ? yield* Effect.tryPromise({
                try: () => readConfigFile(path.join(request.host.homeRoot, managedConfigPath)),
                catch: (error) => error,
              })
            : undefined;
        return {
          file: configSnapshotFile(target),
          selection: automaticConfigSelection({ request, target, global }),
        } satisfies ManagedConfigInspection;
      }
    }
  });

// A reset replaces config.json whatever it holds now, so it keeps the receipt's restoration value
// without requiring the current bytes to still match what was installed.
const resetPreviousConfigFile = (input: {
  receipt: Receipt | undefined;
  snapshot: FileSnapshot;
}): Either.Either<PreviousFileValue, InstallError> => {
  const file = previousReceiptFile(input.receipt, managedConfigPath);
  if (file === undefined) {
    return Either.right(previousFileValue(input.snapshot));
  }

  return file.ownership._tag === "wholeFile"
    ? Either.right(file.ownership.previous)
    : Either.left(
        new InstallError({ issue: `Receipted whole-file file ${managedConfigPath} has incompatible ownership.` }),
      );
};

const createManagedConfigPlan = (input: {
  request: InstallRequest;
  inspection: ManagedConfigInspection;
  previousReceipt: Receipt | undefined;
}): Either.Either<ManagedConfigPlan, InstallError> => {
  const previous =
    input.request.configuration._tag === "reset"
      ? resetPreviousConfigFile({ receipt: input.previousReceipt, snapshot: input.inspection.file })
      : previousWholeFile({
          receipt: input.previousReceipt,
          filePath: managedConfigPath,
          snapshot: input.inspection.file,
        });
  if (Either.isLeft(previous)) {
    return Either.left(previous.left);
  }

  return Either.try({
    try: () =>
      planManagedConfig({
        scope: input.request.destination._tag,
        selection: input.inspection.selection,
        previousConfigFile: previous.right,
      }),
    catch: toInstallError,
  });
};

const installSummary = (input: {
  tag: InstallSummary["_tag"];
  request: InstallRequest;
  featureIds: ReadonlyArray<FeatureId>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
}): InstallSummary => ({
  _tag: input.tag,
  scope: input.request.destination._tag,
  features: input.featureIds,
  agents: input.selectedAgents.map((agent) => agent.id),
  platformRequirements: featureCatalog
    .filter((feature) => input.featureIds.includes(feature.id))
    .map((feature) => ({ featureId: feature.id, platform: feature.platform })),
  interaction: input.request.interaction,
});

// Claude's settings are always planned, so deselecting Claude restores the hooks it received earlier.
const planHookSettings = (input: {
  request: InstallRequest;
  featureIds: ReadonlyArray<FeatureId>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  previousReceipt: Receipt | undefined;
  claudeSettings: { snapshot: FileSnapshot; decoded: DecodedSettings };
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const claude = agentCatalog.find((agent) => agent.id === "claude-code");
    if (claude === undefined) {
      return yield* new InstallError({ issue: "Claude Code catalog entry is missing." });
    }

    const agents = [claude, ...input.selectedAgents.filter((agent) => agent.id !== claude.id)];
    const plans = yield* Effect.forEach(agents, (agent) =>
      Effect.gen(function* () {
        if (agent.nativeHooks._tag === "unsupported") {
          return undefined;
        }

        const filePath = agent.nativeHooks.configPath;
        const isClaudeSettings = filePath === settingsPath;
        const snapshot = isClaudeSettings
          ? input.claudeSettings.snapshot
          : yield* readFileSnapshot(path.join(input.request.destination.root, filePath));

        return yield* planSettings({
          filePath,
          snapshot,
          decoded: isClaudeSettings ? input.claudeSettings.decoded : yield* decodeSettings(snapshot),
          previousFile: previousReceiptFile(input.previousReceipt, filePath),
          desiredGroups: desiredHookGroups({
            root: input.request.destination.root,
            featureIds: input.featureIds,
            selectedAgents: input.selectedAgents,
            agent,
            path,
          }),
          installedHooksFolder: path.join(input.request.destination.root, hooksPath),
        });
      }),
    );

    return plans.filter((plan): plan is FileChange => plan !== undefined);
  });

export const syncInstall = (input: { request: InstallRequest; receiptSnapshot: ReceiptSnapshot }) =>
  Effect.gen(function* () {
    const { request: requested, receiptSnapshot } = input;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const request = yield* decodeStrictly(installRequestSchema)({
      ...requested,
      destination: { ...requested.destination, root: yield* fileSystem.realPath(requested.destination.root) },
      host: { homeRoot: yield* fileSystem.realPath(requested.host.homeRoot) },
    });

    const configInspection = yield* inspectManagedConfig(request);
    const settingsSnapshot = yield* readFileSnapshot(path.join(request.destination.root, settingsPath));
    const settings = yield* decodeSettings(settingsSnapshot);
    const previousReceipt = receiptSnapshot._tag === "present" ? receiptSnapshot.receipt : undefined;
    if (previousReceipt !== undefined && previousReceipt.scope !== request.destination._tag) {
      return yield* new InstallError({ issue: "Existing receipt scope does not match the requested destination." });
    }

    const featureIds = yield* resolveFeatures(request);
    const selectedAgents = yield* resolveAgents(request);
    const hookWrites = yield* createHookWrites({ request, featureIds, previousReceipt });
    const preparedSkills = yield* readPreparedSkills({ request, featureIds });
    const agentWrites = yield* createAgentWrites({ request, selectedAgents, preparedSkills, previousReceipt });
    const managedConfigPlan = yield* createManagedConfigPlan({
      request,
      inspection: configInspection,
      previousReceipt,
    });
    const managedConfigWrite = yield* checkFileChange({
      ...managedConfigPlan.managedConfigWrite,
      expectedCurrent: expectedCurrent(configInspection.file),
    });
    const settingsPlans = yield* planHookSettings({
      request,
      featureIds,
      selectedAgents,
      previousReceipt,
      claudeSettings: { snapshot: settingsSnapshot, decoded: settings },
    });
    const writes = [
      ...hookWrites,
      ...agentWrites,
      managedConfigWrite,
      ...settingsPlans.filter((plan) => plan._tag === "write"),
    ];
    const restorations = yield* planStaleRestorations({
      root: request.destination.root,
      previousReceipt,
      desiredWrites: writes,
      settingsPlans,
    });
    const receipt: Receipt = {
      version: request.preparedPackage.version,
      scope: request.destination._tag,
      features: featureIds,
      ownedFiles: writes.map((write) => write.file),
    };
    const plan = yield* planInstall({
      root: request.destination.root,
      previous: previousReceipt === undefined ? { _tag: "missing" } : { _tag: "receipt", receipt: previousReceipt },
      restorations,
      desired: { receipt, writes },
      receiptTarget,
      receiptExpectedCurrent:
        receiptSnapshot._tag === "missing"
          ? { _tag: "missing" }
          : { _tag: "file", sha256: hashBytes(receiptSnapshot.bytes) },
    });

    const unchanged =
      previousReceipt !== undefined &&
      plan.operations.length === 0 &&
      plan.receipt._tag === "receiptPublish" &&
      receiptEqual(previousReceipt, plan.receipt.receipt);
    if (unchanged) {
      return installSummary({ tag: "unchanged", request, featureIds, selectedAgents });
    }

    yield* applyPlan(plan);

    return installSummary({ tag: "installed", request, featureIds, selectedAgents });
  }).pipe(Effect.mapError(toInstallError));

export const install = (input: unknown) =>
  Effect.gen(function* () {
    const request = yield* decodeStrictly(installRequestSchema)(input);
    const path = yield* Path.Path;
    const receiptSnapshot = yield* readReceipt(path.join(request.destination.root, receiptPath));
    const installedIds = receiptSnapshot._tag === "present" ? receiptSnapshot.receipt.features : [];
    const requestedIds = request.features._tag === "defaults" ? defaultFeatureIds : request.features.ids;
    const features = { _tag: "selected", ids: [...installedIds, ...requestedIds] } as const;

    return yield* syncInstall({ request: { ...request, features }, receiptSnapshot });
  }).pipe(Effect.mapError(toInstallError));
