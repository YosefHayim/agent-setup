import { realpath } from "node:fs/promises";
import * as path from "node:path";

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
  createInstallError,
  type InstallRequest,
  type InstallSummary,
  installRequestSchema,
  wrapAsInstallError,
} from "./install-request.js";
import type { PreviousFileValue } from "./ownership.js";
import { createHookWrites, readPreparedSkills } from "./package-files.js";
import type { ExpectedCurrent, FileChange, ReceiptTarget } from "./plan.js";
import { planInstall } from "./plan-changes.js";
import { encodeReceiptJson, type Receipt, type ReceiptSnapshot, readReceipt } from "./receipt.js";
import { planStaleRestorations } from "./restore.js";

const receiptEqual = (left: Receipt, right: Receipt): boolean => encodeReceiptJson(left) === encodeReceiptJson(right);

const configSnapshotFile = (snapshot: ConfigFileSnapshot): FileSnapshot =>
  snapshot._tag === "missing" ? { _tag: "missing" } : { _tag: "file", bytes: snapshot.bytes };

const listFeaturesWithDependencies = (request: InstallRequest): ReadonlyArray<FeatureId> => {
  const ids = request.features._tag === "defaults" ? defaultFeatureIds : request.features.ids;

  const dependencyCheck = addDependencies(ids);
  const isFeatureUnknown = dependencyCheck.status === "unknown";
  if (isFeatureUnknown) {
    throw createInstallError(`Unknown feature ${dependencyCheck.featureId}.`);
  }

  return dependencyCheck.featureIds;
};

const pickSelectedAgents = (ids: ReadonlyArray<string>): ReadonlyArray<AgentDefinition> => {
  const unknownId = ids.find((id) => !agentCatalog.some((agent) => agent.id === id));
  const isUnknownIdFound = unknownId != null;
  if (isUnknownIdFound) {
    throw createInstallError(`Unknown agent: ${unknownId}`);
  }

  const hasDuplicateIds = ids.length !== new Set(ids).size;
  if (hasDuplicateIds) {
    throw createInstallError("Agent selection contains duplicate IDs.");
  }

  return agentCatalog.filter((agent) => ids.includes(agent.id));
};

const pickAgents = (request: InstallRequest): ReadonlyArray<AgentDefinition> => {
  const agentsRequest = request.agents;
  const isSelectedAgents = agentsRequest._tag === "selected";
  if (isSelectedAgents) {
    return pickSelectedAgents(agentsRequest.ids);
  }

  const detectedAgentIds = detectAgents(agentsRequest.evidence).flatMap((agent) => (agent.installed ? [agent.id] : []));

  return pickSelectedAgents(detectedAgentIds);
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

// The global config is read only when a project install has no config of its own yet.
const readInheritedConfig = async (input: {
  request: InstallRequest;
  target: ConfigFileSnapshot;
}): Promise<ConfigFileSnapshot | undefined> => {
  const isInheritedConfigNeeded = input.request.destination._tag === "project" && input.target._tag === "missing";
  if (isInheritedConfigNeeded) {
    return readConfigFile(path.join(input.request.host.homeRoot, managedConfigPath));
  }

  return undefined;
};

// Decode config.json only when the automatic selection reuses or inherits it; an explicit or reset
// configuration needs just its bytes, so a file the schema no longer accepts cannot block replacing it.
const inspectManagedConfig = async (request: InstallRequest): Promise<ManagedConfigInspection> => {
  const configPath = path.join(request.destination.root, managedConfigPath);
  switch (request.configuration._tag) {
    case "selected":
      return {
        file: await readFileSnapshot(configPath),
        selection: { _tag: "selected", config: request.configuration.config },
      } satisfies ManagedConfigInspection;
    case "reset":
      return {
        file: await readFileSnapshot(configPath),
        selection: { _tag: "selected", config: defaultConfig },
      } satisfies ManagedConfigInspection;
    case "automatic": {
      const target = await readConfigFile(configPath);
      const global = await readInheritedConfig({ request, target });

      return {
        file: configSnapshotFile(target),
        selection: automaticConfigSelection({ request, target, global }),
      } satisfies ManagedConfigInspection;
    }
  }
};

// A reset replaces config.json whatever it holds now, so it keeps the receipt's restoration value
// without requiring the current bytes to still match what was installed.
const resetPreviousConfigFile = (input: {
  receipt: Receipt | undefined;
  snapshot: FileSnapshot;
}): PreviousFileValue => {
  const file = previousReceiptFile(input.receipt, managedConfigPath);
  const isConfigNotReceipted = file == null;
  if (isConfigNotReceipted) {
    return previousFileValue(input.snapshot);
  }

  const ownership = file.ownership;
  const isOwnershipIncompatible = ownership._tag !== "wholeFile";
  if (isOwnershipIncompatible) {
    throw createInstallError(`Receipted whole-file file ${managedConfigPath} has incompatible ownership.`);
  }

  return ownership.previous;
};

const pickPreviousConfigFile = (input: {
  request: InstallRequest;
  inspection: ManagedConfigInspection;
  previousReceipt: Receipt | undefined;
}): PreviousFileValue => {
  const isConfigReset = input.request.configuration._tag === "reset";
  if (isConfigReset) {
    return resetPreviousConfigFile({ receipt: input.previousReceipt, snapshot: input.inspection.file });
  }

  return previousWholeFile({
    receipt: input.previousReceipt,
    filePath: managedConfigPath,
    snapshot: input.inspection.file,
  });
};

const createManagedConfigPlan = (input: {
  request: InstallRequest;
  inspection: ManagedConfigInspection;
  previousReceipt: Receipt | undefined;
}): ManagedConfigPlan => {
  const previousConfigFile = pickPreviousConfigFile(input);

  return planManagedConfig({
    scope: input.request.destination._tag,
    selection: input.inspection.selection,
    previousConfigFile,
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
  features: [...input.featureIds],
  agents: input.selectedAgents.map((agent) => agent.id),
  platformRequirements: featureCatalog
    .filter((feature) => input.featureIds.includes(feature.id))
    .map((feature) => ({ featureId: feature.id, platform: feature.platform })),
  interaction: input.request.interaction,
});

interface DecodedSettingsFile {
  readonly snapshot: FileSnapshot;
  readonly decoded: DecodedSettings;
}

// Claude's settings were read and decoded once already, so only the other agents' files are read here.
const readHookSettingsFile = async (input: {
  root: string;
  filePath: string;
  claudeSettings: DecodedSettingsFile;
}): Promise<DecodedSettingsFile> => {
  const isClaudeSettings = input.filePath === settingsPath;
  if (isClaudeSettings) {
    return input.claudeSettings;
  }

  const snapshot = await readFileSnapshot(path.join(input.root, input.filePath));

  return { snapshot, decoded: decodeSettings(snapshot) };
};

// Claude's settings are always planned, so deselecting Claude restores the hooks it received earlier.
const planHookSettings = async (input: {
  request: InstallRequest;
  featureIds: ReadonlyArray<FeatureId>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  previousReceipt: Receipt | undefined;
  claudeSettings: DecodedSettingsFile;
}): Promise<FileChange[]> => {
  const claude = agentCatalog.find((agent) => agent.id === "claude-code");
  const isClaudeCatalogEntryMissing = claude == null;
  if (isClaudeCatalogEntryMissing) {
    throw createInstallError("Claude Code catalog entry is missing.");
  }

  const agents = [claude, ...input.selectedAgents.filter((agent) => agent.id !== claude.id)];
  const plans: FileChange[] = [];
  for (const agent of agents) {
    const nativeHooks = agent.nativeHooks;
    const isAgentWithoutHooks = nativeHooks._tag === "unsupported";
    if (isAgentWithoutHooks) {
      continue;
    }

    const filePath = nativeHooks.configPath;
    const settingsFile = await readHookSettingsFile({
      root: input.request.destination.root,
      filePath,
      claudeSettings: input.claudeSettings,
    });
    const previousFile = previousReceiptFile(input.previousReceipt, filePath);
    const desiredGroups = desiredHookGroups({
      root: input.request.destination.root,
      featureIds: input.featureIds,
      selectedAgents: input.selectedAgents,
      agent,
      path,
    });
    const installedHooksFolder = path.join(input.request.destination.root, hooksPath);
    const settingsPlan = planSettings({
      filePath,
      snapshot: settingsFile.snapshot,
      decoded: settingsFile.decoded,
      previousFile,
      desiredGroups,
      installedHooksFolder,
    });

    const isThereSettingsChange = settingsPlan != null;

    if (isThereSettingsChange) {
      plans.push(settingsPlan);
    }
  }

  return plans;
};

const pickReceiptExpectedCurrent = (receiptSnapshot: ReceiptSnapshot): ExpectedCurrent => {
  const isReceiptMissing = receiptSnapshot._tag === "missing";
  if (isReceiptMissing) {
    return { _tag: "missing" };
  }

  return { _tag: "file", sha256: hashBytes(receiptSnapshot.bytes) };
};

// Plans the install from the bytes on disk right now, then applies it unless nothing would change.
const planAndApplyInstall = async (
  input: { request: InstallRequest; receiptSnapshot: ReceiptSnapshot },
  signal: AbortSignal,
): Promise<InstallSummary> => {
  const { request: requested, receiptSnapshot } = input;
  const destinationRoot = await realpath(requested.destination.root);
  const homeRoot = await realpath(requested.host.homeRoot);
  const requestInput = {
    ...requested,
    destination: { ...requested.destination, root: destinationRoot },
    host: { homeRoot },
  };
  const request = installRequestSchema.parse(requestInput);

  const configInspection = await inspectManagedConfig(request);
  const settingsSnapshot = await readFileSnapshot(path.join(request.destination.root, settingsPath));
  const settings = decodeSettings(settingsSnapshot);
  const previousReceipt = receiptSnapshot._tag === "present" ? receiptSnapshot.receipt : undefined;
  const isScopeMismatched = previousReceipt != null && previousReceipt.scope !== request.destination._tag;
  if (isScopeMismatched) {
    throw createInstallError("Existing receipt scope does not match the requested destination.");
  }

  const featureIds = listFeaturesWithDependencies(request);
  const selectedAgents = pickAgents(request);
  const hookWrites = await createHookWrites({ request, featureIds, previousReceipt });
  const preparedSkills = await readPreparedSkills({ request, featureIds });
  const agentWrites = await createAgentWrites({ request, selectedAgents, preparedSkills, previousReceipt });
  const managedConfigPlan = createManagedConfigPlan({
    request,
    inspection: configInspection,
    previousReceipt,
  });
  const managedConfigWrite = checkFileChange({
    ...managedConfigPlan.managedConfigWrite,
    expectedCurrent: expectedCurrent(configInspection.file),
  });
  const settingsPlans = await planHookSettings({
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
  const restorations = await planStaleRestorations({
    root: request.destination.root,
    previousReceipt,
    desiredWrites: writes,
    settingsPlans,
  });
  const receipt: Receipt = {
    version: request.preparedPackage.version,
    scope: request.destination._tag,
    features: [...featureIds],
    ownedFiles: writes.map((write) => write.file),
  };
  const plan = planInstall({
    root: request.destination.root,
    previous: previousReceipt === undefined ? { _tag: "missing" } : { _tag: "receipt", receipt: previousReceipt },
    restorations,
    desired: { receipt, writes },
    receiptTarget,
    receiptExpectedCurrent: pickReceiptExpectedCurrent(receiptSnapshot),
  });

  const isUnchangedInstall =
    previousReceipt != null &&
    plan.operations.length === 0 &&
    plan.receipt._tag === "receiptPublish" &&
    receiptEqual(previousReceipt, plan.receipt.receipt);
  if (isUnchangedInstall) {
    return installSummary({ tag: "unchanged", request, featureIds, selectedAgents });
  }

  await applyPlan(plan, signal);

  return installSummary({ tag: "installed", request, featureIds, selectedAgents });
};

export const syncInstall = async (
  input: { request: InstallRequest; receiptSnapshot: ReceiptSnapshot },
  signal: AbortSignal,
): Promise<InstallSummary> => {
  try {
    return await planAndApplyInstall(input, signal);
  } catch (error) {
    throw wrapAsInstallError(error);
  }
};

export const install = async (input: unknown, signal: AbortSignal): Promise<InstallSummary> => {
  try {
    const request = installRequestSchema.parse(input);
    const receiptSnapshot = await readReceipt(path.join(request.destination.root, receiptPath));
    const installedIds = receiptSnapshot._tag === "present" ? receiptSnapshot.receipt.features : [];
    const requestedIds = request.features._tag === "defaults" ? defaultFeatureIds : request.features.ids;
    const features = { _tag: "selected" as const, ids: [...installedIds, ...requestedIds] };

    return await syncInstall({ request: { ...request, features }, receiptSnapshot }, signal);
  } catch (error) {
    throw wrapAsInstallError(error);
  }
};
