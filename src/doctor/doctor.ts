import path from "node:path";

import { z } from "zod";

import { type AgentEvidence, agentCatalog, agentEvidenceSchema, detectAgents } from "#src/catalog/agent-catalog.js";
import {
  addDependencies,
  type FeatureDefinition,
  type FeatureId,
  type FeaturePlatform,
  featureCatalog,
} from "#src/catalog/feature-catalog.js";
import { type ConfigFileSnapshot, managedConfigPath, readConfigFile } from "#src/config/config-file.js";
import type { Config } from "#src/config/config-schema.js";
import { hostPlatformSchema } from "#src/config/host-scan.js";
import { installationDestinationSchema, receiptPath } from "#src/install/install-paths.js";
import { preparedPackageSchema, readErrorMessage, wrapAsInstallError } from "#src/install/install-request.js";
import { isPathPresent } from "#src/install/prepare-package.js";
import { type Receipt, type ReceiptSnapshot, readReceipt, type Scope } from "#src/install/receipt.js";
import { joinZodIssueMessages } from "#src/zod-issue-messages.js";

const healthRequestSchema = z.strictObject({
  destination: installationDestinationSchema,
  preparedPackage: preparedPackageSchema,
  platform: hostPlatformSchema,
  agentEvidence: agentEvidenceSchema,
});

type HealthRequest = z.infer<typeof healthRequestSchema>;

export type ConfigHealth = { readonly _tag: "missing" } | { readonly _tag: "present"; readonly config: Config };

export type InstallationHealth =
  | { readonly _tag: "missing" }
  | { readonly _tag: "present"; readonly version: string; readonly features: Array<string> };

export type PreparedRuntimeStatus =
  | { readonly _tag: "notRequired" }
  | { readonly _tag: "present"; readonly path: string }
  | { readonly _tag: "missing"; readonly path: string };

export interface FeatureHealth {
  readonly id: FeatureId;
  readonly title: string;
  readonly platform: FeaturePlatform;
  readonly platformAvailable: boolean;
  readonly preparedRuntime: PreparedRuntimeStatus;
}

export interface AgentHealth {
  readonly id: string;
  readonly displayName: string;
  readonly detected: boolean;
  readonly managed: boolean;
  readonly nativeHookSupport: "verified" | "unsupported";
}

export type Discrepancy =
  | { readonly _tag: "receiptScopeMismatch"; readonly requestedScope: Scope; readonly receiptScope: Scope }
  | { readonly _tag: "packageVersionMismatch"; readonly installedVersion: string; readonly preparedVersion: string }
  | { readonly _tag: "missingManagedConfig" }
  | { readonly _tag: "unsupportedFeaturePlatform"; readonly featureId: FeatureId; readonly platform: FeaturePlatform }
  | { readonly _tag: "missingPreparedRuntime"; readonly featureId: FeatureId; readonly path: string }
  | { readonly _tag: "detectedAgentNotManaged"; readonly agentId: string }
  | { readonly _tag: "managedAgentNotDetected"; readonly agentId: string }
  | { readonly _tag: "missingFeatureDependency"; readonly featureId: FeatureId };

export interface HealthReport {
  readonly scope: Scope;
  readonly config: ConfigHealth;
  readonly installation: InstallationHealth;
  readonly features: Array<FeatureHealth>;
  readonly agents: Array<AgentHealth>;
  readonly discrepancies: Array<Discrepancy>;
}

interface Inspection {
  readonly configSnapshot: ConfigFileSnapshot;
  readonly receipt: Receipt | null;
  readonly features: Array<FeatureHealth>;
}

const createInspectError = (issue: string, cause: unknown): Error =>
  new Error(`Cannot inspect agent-setup: ${issue}`, { cause });

const decodeHealthRequest = (input: unknown): HealthRequest => {
  const requestCheck = healthRequestSchema.safeParse(input);
  const isRequestAccepted = requestCheck.success;

  if (isRequestAccepted) {
    return requestCheck.data;
  }

  throw createInspectError(joinZodIssueMessages(requestCheck.error), requestCheck.error);
};

const platformAvailable = (feature: FeatureDefinition, platform: HealthRequest["platform"]): boolean => {
  const isAnyPlatform = feature.platform === "any";

  if (isAnyPlatform) {
    return true;
  }

  const isHostNotDarwin = platform.operatingSystem !== "darwin";

  if (isHostNotDarwin) {
    return false;
  }

  return feature.platform === "macos";
};

const preparedRuntimeStatus = async (
  feature: FeatureDefinition,
  packageRoot: string,
): Promise<PreparedRuntimeStatus> => {
  const runtime = feature.runtime;

  const isRuntimeNotRequired = runtime._tag === "none";

  if (isRuntimeNotRequired) {
    return { _tag: "notRequired" };
  }

  const typeScriptExtensionLength = 3;
  const entrypoint = `${runtime.sourceEntrypoint.slice(0, -typeScriptExtensionLength)}.js`;
  const relativePath = `hooks/${feature.sourceDirectory}/${entrypoint}`;
  const isEntrypointPresent = await isPathPresent(path.join(packageRoot, relativePath));

  if (isEntrypointPresent) {
    return { _tag: "present", path: relativePath };
  }

  return { _tag: "missing", path: relativePath };
};

const checkFeature = async (feature: FeatureDefinition, request: HealthRequest): Promise<FeatureHealth> => {
  const preparedRuntime = await preparedRuntimeStatus(feature, request.preparedPackage.root);

  return {
    id: feature.id,
    title: feature.title,
    platform: feature.platform,
    platformAvailable: platformAvailable(feature, request.platform),
    preparedRuntime,
  };
};

const checkFeatureHealth = async (request: HealthRequest, receipt: Receipt): Promise<Array<FeatureHealth>> => {
  const installedFeatureIds = new Set(receipt.features);
  const installedFeatures = featureCatalog.filter((feature) => installedFeatureIds.has(feature.id));

  return Promise.all(installedFeatures.map((feature) => checkFeature(feature, request)));
};

// The receipt lists what is installed; a dependency it lacks is reported, and install or update adds it.
const findMissingDependencies = (receipt: Receipt): Array<Discrepancy> => {
  const recordedIds = new Set<string>(receipt.features);
  const dependencyCheck = addDependencies(receipt.features);
  const isRequiredFeatureUnknown = dependencyCheck.status === "unknown";

  if (isRequiredFeatureUnknown) {
    throw new Error(`Unknown feature ${dependencyCheck.featureId}.`);
  }

  const requiredIds = dependencyCheck.featureIds;

  return requiredIds
    .filter((featureId) => !recordedIds.has(featureId))
    .map((featureId) => ({ _tag: "missingFeatureDependency" as const, featureId }));
};

const listManagedAgentIds = (receipt: Receipt | null): Array<string> => {
  const isReceiptMissing = receipt == null;

  if (isReceiptMissing) {
    return [];
  }

  return receipt.ownedFiles.flatMap((file) => {
    const owner = file.owner;
    const isAgentOwned = owner._tag === "agent";

    return isAgentOwned ? owner.agentIds : [];
  });
};

const checkAgentHealth = (evidence: AgentEvidence, receipt: Receipt | null): Array<AgentHealth> => {
  const managedIds = new Set(listManagedAgentIds(receipt));
  const detectedAgents = new Map(detectAgents(evidence).map((agent) => [agent.id, agent.installed]));

  return agentCatalog.map((agent): AgentHealth => {
    const isNativeHookUnsupported = agent.nativeHooks._tag === "unsupported";

    return {
      id: agent.id,
      displayName: agent.displayName,
      detected: detectedAgents.get(agent.id) === true,
      managed: managedIds.has(agent.id),
      nativeHookSupport: isNativeHookUnsupported ? "unsupported" : "verified",
    };
  });
};

const readReceiptOrInstallError = async (receiptFilePath: string): Promise<ReceiptSnapshot> => {
  try {
    return await readReceipt(receiptFilePath);
  } catch (error) {
    throw wrapAsInstallError(error);
  }
};

const inspectInstallation = async (request: HealthRequest): Promise<Inspection> => {
  const configFilePath = path.join(request.destination.root, managedConfigPath);
  const receiptFilePath = path.join(request.destination.root, receiptPath);

  try {
    const configSnapshot = await readConfigFile(configFilePath);
    const receiptSnapshot = await readReceiptOrInstallError(receiptFilePath);
    const isReceiptMissing = receiptSnapshot._tag === "missing";

    if (isReceiptMissing) {
      return { configSnapshot, receipt: null, features: [] };
    }

    const features = await checkFeatureHealth(request, receiptSnapshot.receipt);

    return { configSnapshot, receipt: receiptSnapshot.receipt, features };
  } catch (error) {
    throw createInspectError(readErrorMessage(error), error);
  }
};

const pickConfigHealth = (snapshot: ConfigFileSnapshot): ConfigHealth => {
  const isConfigMissing = snapshot._tag === "missing";

  if (isConfigMissing) {
    return { _tag: "missing" };
  }

  return { _tag: "present", config: snapshot.config };
};

const pickInstallationHealth = (receipt: Receipt | null): InstallationHealth => {
  const isReceiptMissing = receipt == null;

  if (isReceiptMissing) {
    return { _tag: "missing" };
  }

  return { _tag: "present", version: receipt.version, features: receipt.features };
};

const findReceiptDiscrepancies = (request: HealthRequest, inspection: Inspection): Array<Discrepancy> => {
  const receipt = inspection.receipt;
  const isReceiptMissing = receipt == null;

  if (isReceiptMissing) {
    return [];
  }

  const discrepancies: Array<Discrepancy> = [];
  const isScopeMismatched = receipt.scope !== request.destination._tag;

  if (isScopeMismatched) {
    discrepancies.push({
      _tag: "receiptScopeMismatch",
      requestedScope: request.destination._tag,
      receiptScope: receipt.scope,
    });
  }

  const isVersionMismatched = receipt.version !== request.preparedPackage.version;

  if (isVersionMismatched) {
    discrepancies.push({
      _tag: "packageVersionMismatch",
      installedVersion: receipt.version,
      preparedVersion: request.preparedPackage.version,
    });
  }

  const isManagedConfigMissing = inspection.configSnapshot._tag === "missing";

  if (isManagedConfigMissing) {
    discrepancies.push({ _tag: "missingManagedConfig" });
  }

  discrepancies.push(...findMissingDependencies(receipt));

  return discrepancies;
};

const findFeatureDiscrepancies = (feature: FeatureHealth): Array<Discrepancy> => {
  const discrepancies: Array<Discrepancy> = [];
  const isPlatformUnavailable = !feature.platformAvailable;

  if (isPlatformUnavailable) {
    discrepancies.push({ _tag: "unsupportedFeaturePlatform", featureId: feature.id, platform: feature.platform });
  }

  const preparedRuntime = feature.preparedRuntime;
  const isRuntimeMissing = preparedRuntime._tag === "missing";

  if (isRuntimeMissing) {
    discrepancies.push({ _tag: "missingPreparedRuntime", featureId: feature.id, path: preparedRuntime.path });
  }

  return discrepancies;
};

const findAgentDiscrepancies = (agents: Array<AgentHealth>): Array<Discrepancy> => {
  const discrepancies: Array<Discrepancy> = [];

  for (const agent of agents) {
    const isDetectedButUnmanaged = agent.detected && !agent.managed;

    if (isDetectedButUnmanaged) {
      discrepancies.push({ _tag: "detectedAgentNotManaged", agentId: agent.id });
    }

    const isManagedButUndetected = agent.managed && !agent.detected;

    if (isManagedButUndetected) {
      discrepancies.push({ _tag: "managedAgentNotDetected", agentId: agent.id });
    }
  }

  return discrepancies;
};

// Discrepancies are report data only; they never authorize a repair.
const findDiscrepancies = (
  request: HealthRequest,
  inspection: Inspection,
  agents: Array<AgentHealth>,
): Array<Discrepancy> => {
  const receiptDiscrepancies = findReceiptDiscrepancies(request, inspection);
  const featureDiscrepancies = inspection.features.flatMap(findFeatureDiscrepancies);
  const agentDiscrepancies = findAgentDiscrepancies(agents);

  return [...receiptDiscrepancies, ...featureDiscrepancies, ...agentDiscrepancies];
};

// Compares the strict receipt and config with catalog-derived host observations, without writing anything.
export const checkHealth = async (input: unknown): Promise<HealthReport> => {
  const request = decodeHealthRequest(input);
  const inspection = await inspectInstallation(request);
  const agents = checkAgentHealth(request.agentEvidence, inspection.receipt);
  const discrepancies = findDiscrepancies(request, inspection, agents);

  return {
    scope: request.destination._tag,
    config: pickConfigHealth(inspection.configSnapshot),
    installation: pickInstallationHealth(inspection.receipt),
    features: inspection.features,
    agents,
    discrepancies,
  };
};
