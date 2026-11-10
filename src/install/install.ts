import { realpath } from "node:fs/promises";
import * as path from "node:path";

import { type AgentDefinition, agentCatalog, detectAgents } from "#src/catalog/agent-catalog.js";
import { addDependencies, defaultFeatureIds, type FeatureId, featureCatalog } from "#src/catalog/feature-catalog.js";
import {
  type ConfigFileSnapshot,
  type ManagedConfigPlan,
  type ManagedConfigRequest,
  managedConfigPath,
  planManagedConfig,
  readConfigFile,
} from "#src/config/config-file.js";
import { defaultConfig } from "#src/config/config-schema.js";
import { createAgentWrites } from "./agent-files.js";
import { applyPlan } from "./apply-plan.js";
import { hashBytes } from "./file-bytes.js";
import { type DecodedSettings, decodeSettings, planSettings, readDesiredHookGroups } from "./hook-settings.js";
import {
  applicationOwner,
  checkFileChange,
  type FileSnapshot,
  readExpectedCurrent,
  readFileSnapshot,
  readPreviousFileField,
  readPreviousReceiptFile,
  readPreviousWholeFile,
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
import { encodeReceiptDocument, type Receipt, type ReceiptSnapshot, readReceipt } from "./receipt.js";
import { planStaleRestorations } from "./restore.js";

const isReceiptEqual = (left: Receipt, right: Receipt): boolean =>
  encodeReceiptDocument(left) === encodeReceiptDocument(right);

const readSettingsSnapshotFile = (snapshot: ConfigFileSnapshot): FileSnapshot => {
  const isSnapshotMissing = snapshot._tag === "missing";
  if (isSnapshotMissing) {
    return { _tag: "missing" };
  }

  return { _tag: "file", bytes: snapshot.bytes };
};

const listFeaturesWithCollaborators = (request: InstallRequest): ReadonlyArray<FeatureId> => {
  const features = request.features;
  const isDefaultFeatures = features._tag === "defaults";
  const ids = isDefaultFeatures ? defaultFeatureIds : features.ids;

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

  const detectedAgentIds = detectAgents(agentsRequest.evidence).flatMap((agent) => {
    const isAgentInstalled = agent.installed;

    return isAgentInstalled ? [agent.id] : [];
  });

  return pickSelectedAgents(detectedAgentIds);
};

const receiptTarget: ReceiptTarget = {
  path: receiptPath,
  kind: { _tag: "receipt" },
  owner: applicationOwner,
};

const readAutomaticSettingsSelection = (selectionRead: {
  request: InstallRequest;
  target: ConfigFileSnapshot;
  global: ConfigFileSnapshot | null;
}): ManagedConfigRequest["selection"] => {
  const target = selectionRead.target;
  const isTargetPresent = target._tag === "present";
  if (isTargetPresent) {
    return { _tag: "selected", config: target.config };
  }

  const isProjectInstall = selectionRead.request.destination._tag === "project";
  if (isProjectInstall) {
    const globalSnapshot = selectionRead.global;
    const isGlobalSnapshotMissing = globalSnapshot == null;

    return {
      _tag: "firstProjectInstall",
      globalConfig: isGlobalSnapshotMissing ? { _tag: "missing" } : globalSnapshot,
    };
  }

  return { _tag: "selected", config: defaultConfig };
};

type ManagedSettingsInspection = {
  readonly file: FileSnapshot;
  readonly selection: ManagedConfigRequest["selection"];
};

// The global config is read only when a project install has no config of its own yet.
const readInheritedSettings = async (inheritedRead: {
  request: InstallRequest;
  target: ConfigFileSnapshot;
}): Promise<ConfigFileSnapshot | null> => {
  const isInheritedSettingsNeeded =
    inheritedRead.request.destination._tag === "project" && inheritedRead.target._tag === "missing";
  if (isInheritedSettingsNeeded) {
    return readConfigFile(path.join(inheritedRead.request.host.homeRoot, managedConfigPath));
  }

  return null;
};

// Decode config.json only when the automatic selection reuses or inherits it; an explicit or reset
// configuration needs just its bytes, so a file the schema no longer accepts cannot block replacing it.
const inspectManagedSettings = async (request: InstallRequest): Promise<ManagedSettingsInspection> => {
  const settingsPath = path.join(request.destination.root, managedConfigPath);
  switch (request.configuration._tag) {
    case "selected":
      return {
        file: await readFileSnapshot(settingsPath),
        selection: { _tag: "selected", config: request.configuration.config },
      } satisfies ManagedSettingsInspection;
    case "reset":
      return {
        file: await readFileSnapshot(settingsPath),
        selection: { _tag: "selected", config: defaultConfig },
      } satisfies ManagedSettingsInspection;
    case "automatic": {
      const target = await readConfigFile(settingsPath);
      const globalSnapshot = await readInheritedSettings({ request, target });

      return {
        file: readSettingsSnapshotFile(target),
        selection: readAutomaticSettingsSelection({ request, target, global: globalSnapshot }),
      } satisfies ManagedSettingsInspection;
    }
  }
};

// A reset replaces config.json whatever it holds now, so it keeps the receipt's restoration value
// without requiring the current bytes to still match what was installed.
const resetPreviousSettingsFile = (previousFileReset: {
  receipt: Receipt | null;
  snapshot: FileSnapshot;
}): PreviousFileValue => {
  const file = readPreviousReceiptFile(previousFileReset.receipt, managedConfigPath);

  const isSettingsNotReceipted = file == null;
  if (isSettingsNotReceipted) {
    return readPreviousFileField(previousFileReset.snapshot);
  }

  const ownership = file.ownership;

  const isOwnershipIncompatible = ownership._tag !== "wholeFile";
  if (isOwnershipIncompatible) {
    throw createInstallError(`Receipted whole-file file ${managedConfigPath} has incompatible ownership.`);
  }

  return ownership.previous;
};

const pickPreviousSettingsFile = (previousFilePick: {
  request: InstallRequest;
  inspection: ManagedSettingsInspection;
  previousReceipt: Receipt | null;
}): PreviousFileValue => {
  const isSettingsReset = previousFilePick.request.configuration._tag === "reset";
  if (isSettingsReset) {
    return resetPreviousSettingsFile({
      receipt: previousFilePick.previousReceipt,
      snapshot: previousFilePick.inspection.file,
    });
  }

  return readPreviousWholeFile({
    receipt: previousFilePick.previousReceipt,
    filePath: managedConfigPath,
    snapshot: previousFilePick.inspection.file,
    desiredBytes: null,
  });
};

const createManagedSettingsPlan = (managedPlanning: {
  request: InstallRequest;
  inspection: ManagedSettingsInspection;
  previousReceipt: Receipt | null;
}): ManagedConfigPlan => {
  const previousSettingsFile = pickPreviousSettingsFile(managedPlanning);

  return planManagedConfig({
    scope: managedPlanning.request.destination._tag,
    selection: managedPlanning.inspection.selection,
    previousConfigFile: previousSettingsFile,
  });
};

const installSummary = (summary: {
  tag: InstallSummary["_tag"];
  request: InstallRequest;
  featureIds: ReadonlyArray<FeatureId>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
}): InstallSummary => ({
  _tag: summary.tag,
  scope: summary.request.destination._tag,
  features: [...summary.featureIds],
  agents: summary.selectedAgents.map((agent) => agent.id),
  platformRequirements: featureCatalog
    .filter((feature) => summary.featureIds.includes(feature.id))
    .map((feature) => ({ featureId: feature.id, platform: feature.platform })),
  interaction: summary.request.interaction,
});

interface DecodedSettingsFile {
  readonly snapshot: FileSnapshot;
  readonly decoded: DecodedSettings;
}

// Claude's settings were read and decoded once already, so only the other agents' files are read here.
const readHookSettingsFile = async (hookFileRead: {
  root: string;
  filePath: string;
  claudeSettings: DecodedSettingsFile;
}): Promise<DecodedSettingsFile> => {
  const isClaudeSettings = hookFileRead.filePath === settingsPath;
  if (isClaudeSettings) {
    return hookFileRead.claudeSettings;
  }

  const snapshot = await readFileSnapshot(path.join(hookFileRead.root, hookFileRead.filePath));

  return { snapshot, decoded: decodeSettings(snapshot) };
};

// Claude's settings are always planned, so deselecting Claude restores the hooks it received earlier.
const planHookSettings = async (hookSettingsRequest: {
  request: InstallRequest;
  featureIds: ReadonlyArray<FeatureId>;
  selectedAgents: ReadonlyArray<AgentDefinition>;
  previousReceipt: Receipt | null;
  claudeSettings: DecodedSettingsFile;
}): Promise<FileChange[]> => {
  const claude = agentCatalog.find((agent) => agent.id === "claude-code");

  const isClaudeCatalogLineMissing = claude == null;
  if (isClaudeCatalogLineMissing) {
    throw createInstallError("Claude Code catalog entry is missing.");
  }

  const agents = [claude, ...hookSettingsRequest.selectedAgents.filter((agent) => agent.id !== claude.id)];
  const plans: FileChange[] = [];
  for (const agent of agents) {
    const nativeHooks = agent.nativeHooks;

    const isAgentWithoutHooks = nativeHooks._tag === "unsupported";
    if (isAgentWithoutHooks) {
      continue;
    }

    const filePath = nativeHooks.configPath;
    const settingsFile = await readHookSettingsFile({
      root: hookSettingsRequest.request.destination.root,
      filePath,
      claudeSettings: hookSettingsRequest.claudeSettings,
    });
    const previousFile = readPreviousReceiptFile(hookSettingsRequest.previousReceipt, filePath);
    const desiredGroups = readDesiredHookGroups({
      root: hookSettingsRequest.request.destination.root,
      featureIds: hookSettingsRequest.featureIds,
      selectedAgents: hookSettingsRequest.selectedAgents,
      agent,
      path,
    });
    const installedHooksFolder = path.join(hookSettingsRequest.request.destination.root, hooksPath);
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
  installWithReceipt: { request: InstallRequest; receiptSnapshot: ReceiptSnapshot },
  signal: AbortSignal,
): Promise<InstallSummary> => {
  const { request: requested, receiptSnapshot } = installWithReceipt;
  const destinationRoot = await realpath(requested.destination.root);
  const homeRoot = await realpath(requested.host.homeRoot);
  const realPathRequest = {
    ...requested,
    destination: { ...requested.destination, root: destinationRoot },
    host: { homeRoot },
  };
  const request = installRequestSchema.parse(realPathRequest);

  const settingsInspection = await inspectManagedSettings(request);
  const settingsSnapshot = await readFileSnapshot(path.join(request.destination.root, settingsPath));
  const settings = decodeSettings(settingsSnapshot);
  const isReceiptPresent = receiptSnapshot._tag === "present";
  const previousReceipt = isReceiptPresent ? receiptSnapshot.receipt : null;

  const isScopeMismatched = previousReceipt != null && previousReceipt.scope !== request.destination._tag;
  if (isScopeMismatched) {
    throw createInstallError("Existing receipt scope does not match the requested destination.");
  }

  const featureIds = listFeaturesWithCollaborators(request);
  const selectedAgents = pickAgents(request);
  const hookWrites = await createHookWrites({ request, featureIds, previousReceipt });
  const preparedSkills = await readPreparedSkills({ request, featureIds });
  const agentWrites = await createAgentWrites({ request, selectedAgents, preparedSkills, previousReceipt });
  const managedSettingsPlan = createManagedSettingsPlan({
    request,
    inspection: settingsInspection,
    previousReceipt,
  });
  const managedSettingsWrite = checkFileChange({
    ...managedSettingsPlan.managedConfigWrite,
    expectedCurrent: readExpectedCurrent(settingsInspection.file),
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
    managedSettingsWrite,
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
  const isPreviousReceiptMissing = previousReceipt == null;
  const plan = planInstall({
    root: request.destination.root,
    previous: isPreviousReceiptMissing ? { _tag: "missing" } : { _tag: "receipt", receipt: previousReceipt },
    restorations,
    desired: { receipt, writes },
    receiptTarget,
    receiptExpectedCurrent: pickReceiptExpectedCurrent(receiptSnapshot),
  });

  const isUnchangedInstall =
    previousReceipt != null &&
    plan.operations.length === 0 &&
    plan.receipt._tag === "receiptPublish" &&
    isReceiptEqual(previousReceipt, plan.receipt.receipt);
  if (isUnchangedInstall) {
    return installSummary({ tag: "unchanged", request, featureIds, selectedAgents });
  }

  await applyPlan(plan, signal);

  return installSummary({ tag: "installed", request, featureIds, selectedAgents });
};

export const syncInstall = async (
  installWithReceipt: { request: InstallRequest; receiptSnapshot: ReceiptSnapshot },
  signal: AbortSignal,
): Promise<InstallSummary> => {
  try {
    return await planAndApplyInstall(installWithReceipt, signal);
  } catch (error) {
    throw wrapAsInstallError(error);
  }
};

export const install = async (uncheckedRequest: unknown, signal: AbortSignal): Promise<InstallSummary> => {
  try {
    const request = installRequestSchema.parse(uncheckedRequest);
    const receiptSnapshot = await readReceipt(path.join(request.destination.root, receiptPath));
    const isReceiptPresent = receiptSnapshot._tag === "present";
    const installedIds = isReceiptPresent ? receiptSnapshot.receipt.features : [];
    const requestedFeatures = request.features;
    const isDefaultFeatureRequest = requestedFeatures._tag === "defaults";
    const requestedIds = isDefaultFeatureRequest ? defaultFeatureIds : requestedFeatures.ids;
    const features = { _tag: "selected" as const, ids: [...installedIds, ...requestedIds] };

    return await syncInstall({ request: { ...request, features }, receiptSnapshot }, signal);
  } catch (error) {
    throw wrapAsInstallError(error);
  }
};
