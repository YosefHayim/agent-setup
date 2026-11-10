import { join, resolve } from "node:path";

import type { Command } from "commander";

import { detectAgents } from "#src/catalog/agent-catalog.js";
import { defaultFeatureIds, featureCatalog } from "#src/catalog/feature-catalog.js";
import { type HostScan, readDestinationForScope, scanHost } from "#src/config/host-scan.js";
import { install } from "#src/install/install.js";
import { receiptPath } from "#src/install/install-paths.js";
import { wrapAsInstallError } from "#src/install/install-request.js";
import { preparePackage } from "#src/install/prepare-package.js";
import { readReceipt } from "#src/install/receipt.js";
import { uninstall } from "#src/install/uninstall.js";
import { update } from "#src/install/update.js";
import { copyWorkflows } from "#src/workflows/copy-workflows.js";
import { showFeatureList } from "./catalog-command.js";
import { createCommand } from "./cli-options.js";
import { checkBothScopes, showScopeHealth } from "./doctor-command.js";
import { showInstallation } from "./install-command.js";
import { applyIfApproved, pickScope, runSettings } from "./menu-settings.js";
import * as TerminalUI from "./terminal-ui.js";
import { showUninstallation } from "./uninstall-command.js";
import { showUpdate } from "./update-command.js";
import { findWorkflowTemplateDirectory, showCopiedWorkflows } from "./workflow-command.js";

type MenuScreen = "install" | "update" | "uninstall" | "config" | "doctor" | "catalog" | "workflow";

type UpdateMode = "preserve" | "selected";

type UpdateFeatures =
  | { readonly _tag: "preserve" }
  | { readonly _tag: "selected"; readonly ids: ReadonlyArray<string> };

const readAgentSummary = (host: HostScan): string => {
  const detected = detectAgents(host.agentEvidence)
    .filter((agent) => agent.installed)
    .map((agent) => agent.displayName);
  const isThereDetectedAgent = detected.length > 0;
  return isThereDetectedAgent ? detected.join(", ") : "none detected";
};

const readFeatureList = (ids: ReadonlyArray<string>): string => {
  const isThereFeature = ids.length > 0;
  return isThereFeature ? ids.join(", ") : "(none)";
};

const pickFeatures = (initial: ReadonlyArray<string>): Promise<string[]> =>
  TerminalUI.listMultiSelect({
    message: "Select features (space toggles, enter confirms)",
    choices: featureCatalog.map((feature) => ({
      label: feature.title,
      value: feature.id,
      hint: `${feature.id} · ${feature.summary}`,
    })),
    initial,
  });

const pickDestination = async (verb: string) => {
  const scope = await pickScope(verb);
  const host = await scanHost();
  const destination = readDestinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });
  return { scope, host, destination };
};

const readReceiptSnapshot = async (destinationRoot: string) => {
  try {
    return await readReceipt(join(destinationRoot, receiptPath));
  } catch (error) {
    throw wrapAsInstallError(error);
  }
};

const readUpdateFeatures = async (request: {
  readonly mode: UpdateMode;
  readonly installedIds: ReadonlyArray<string>;
}): Promise<UpdateFeatures> => {
  const isPreserveMode = request.mode === "preserve";
  if (isPreserveMode) {
    return { _tag: "preserve" };
  }

  const selectedIds = await pickFeatures(request.installedIds);
  return { _tag: "selected", ids: selectedIds };
};

const runInstallScreen = async (abortSignal: AbortSignal): Promise<void> => {
  const { scope, host, destination } = await pickDestination("Install");
  const features = await pickFeatures(defaultFeatureIds);
  await applyIfApproved({
    title: "Install plan",
    steps: [
      { label: "Action", detail: "add features + hooks; installed features are kept" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      { label: "Features", detail: readFeatureList(features) },
      { label: "Agents", detail: `${readAgentSummary(host)} (auto-detected)` },
      { label: "Config", detail: "automatic (reuse / inherit / defaults)" },
    ],
    confirmMessage: "Apply this install plan?",
    apply: async () => {
      const preparedPackage = await preparePackage();
      const installRequest = {
        destination,
        host: { homeRoot: host.homeRoot },
        preparedPackage,
        features: { _tag: "selected", ids: features },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "interactive" },
        configuration: { _tag: "automatic" },
      };
      const installation = await install(installRequest, abortSignal);
      await showInstallation(installation);
    },
  });
};

const runUpdateScreen = async (abortSignal: AbortSignal): Promise<void> => {
  const { scope, host, destination } = await pickDestination("Update");
  const mode = await TerminalUI.selectOne<UpdateMode>({
    message: "Feature selection",
    choices: [
      { label: "Preserve installed set", value: "preserve", hint: "refresh payload only" },
      { label: "Choose features", value: "selected", hint: "unticked installed features are removed" },
    ],
    initial: "preserve",
  });
  const receiptSnapshot = await readReceiptSnapshot(destination.root);
  const isReceiptPresent = receiptSnapshot._tag === "present";
  const installedIds = isReceiptPresent ? receiptSnapshot.receipt.features : defaultFeatureIds;
  const features = await readUpdateFeatures({ mode, installedIds });
  const isPreserveFeatures = features._tag === "preserve";
  const featureDetail = isPreserveFeatures ? "preserve receipt selection" : readFeatureList(features.ids);

  await applyIfApproved({
    title: "Update plan",
    steps: [
      { label: "Action", detail: "update / refresh installation" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      { label: "Features", detail: featureDetail },
      { label: "Agents", detail: `${readAgentSummary(host)} (auto-detected)` },
      { label: "Config", detail: "automatic" },
    ],
    confirmMessage: "Apply this update plan?",
    apply: async () => {
      const preparedPackage = await preparePackage();
      const updateSummary = await update(
        {
          destination,
          host: { homeRoot: host.homeRoot },
          preparedPackage,
          features,
          agents: { _tag: "detected", evidence: host.agentEvidence },
          interaction: { _tag: "interactive" },
          configuration: { _tag: "automatic" },
        },
        abortSignal,
      );
      await showUpdate(updateSummary);
    },
  });
};

const runUninstallScreen = async (abortSignal: AbortSignal): Promise<void> => {
  const { scope, host, destination } = await pickDestination("Uninstall");
  await applyIfApproved({
    title: "Uninstall plan",
    steps: [
      { label: "Action", detail: "remove receipt-owned installation" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      { label: "Safety", detail: "only receipt-authorized files are removed" },
    ],
    confirmMessage: `Uninstall agent-setup from ${scope}?`,
    apply: async () => {
      const uninstallation = await uninstall(
        { destination, host: { homeRoot: host.homeRoot }, interaction: { _tag: "interactive" } },
        abortSignal,
      );
      await showUninstallation(uninstallation);
    },
  });
};

const runWorkflowScreen = async (): Promise<void> => {
  const workspace = await TerminalUI.readOptionalString({
    message: "Target workspace (repository root)",
    fallback: resolve(process.cwd()),
  });
  const targetRoot = resolve(workspace);
  const isOverwriteRequested = await TerminalUI.confirm({
    message: "Overwrite existing workflow files?",
    initialValue: false,
  });
  const templateDirectory = await findWorkflowTemplateDirectory();
  const overwriteDetail = isOverwriteRequested ? "yes" : "no (skip existing)";

  await applyIfApproved({
    title: "Workflow scaffold plan",
    steps: [
      { label: "Action", detail: "copy CI + publish workflow templates" },
      { label: "Workspace", detail: targetRoot },
      { label: "Overwrite", detail: overwriteDetail },
      { label: "Templates", detail: templateDirectory },
    ],
    confirmMessage: "Apply this workflow scaffold plan?",
    apply: async () => {
      const copiedWorkflows = await copyWorkflows({ targetRoot, templateDirectory, force: isOverwriteRequested });
      await showCopiedWorkflows(copiedWorkflows);
    },
  });
};

const runDoctorScreen = async (): Promise<void> => {
  const scopes = await checkBothScopes();
  for (const scopeHealth of scopes) {
    await showScopeHealth(scopeHealth);
  }
};

const runCatalogScreen = async (): Promise<void> => {
  await TerminalUI.runIntro("catalog");
  await showFeatureList();
};

const runMenuScreen = async (screen: MenuScreen, abortSignal: AbortSignal): Promise<void> => {
  switch (screen) {
    case "install":
      await runInstallScreen(abortSignal);
      return;
    case "update":
      await runUpdateScreen(abortSignal);
      return;
    case "uninstall":
      await runUninstallScreen(abortSignal);
      return;
    case "config":
      await runSettings(abortSignal);
      return;
    case "doctor":
      await runDoctorScreen();
      return;
    case "catalog":
      await runCatalogScreen();
      return;
    case "workflow":
      await runWorkflowScreen();
      return;
  }
};

export const createMenuCommand = (abortSignal: AbortSignal): Command =>
  createCommand("menu")
    .description("Interactive TUI: same options as CLI args, ordered plan preview, approve before apply")
    .action(async () => {
      await TerminalUI.runIntro("menu");
      const action = await TerminalUI.selectOne<MenuScreen | "exit">({
        message: "What would you like to do?",
        choices: [
          { label: "Install", value: "install", hint: "features + hooks (plan → approve)" },
          { label: "Update", value: "update", hint: "refresh installation" },
          { label: "Uninstall", value: "uninstall", hint: "remove receipt-owned install" },
          { label: "Configure", value: "config", hint: "show / set / reset" },
          { label: "Doctor", value: "doctor", hint: "read-only health check" },
          { label: "Catalog", value: "catalog", hint: "list feature IDs" },
          { label: "Workflow scaffold", value: "workflow", hint: "CI + publish templates" },
          { label: "Exit", value: "exit", hint: "close the menu" },
        ],
        initial: "install",
      });

      const isExit = action === "exit";
      if (isExit) {
        await TerminalUI.runOutro("Closed.");
        return;
      }

      await runMenuScreen(action, abortSignal);
      await TerminalUI.runOutro("Done.");
    });
