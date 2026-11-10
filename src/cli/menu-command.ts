/** `agent-setup menu` — pick an action, gather the options its CLI command takes, approve a plan, then run the same work. */

import { Command } from "@effect/cli";
import { Path } from "@effect/platform";
import { Effect } from "effect";

import { detectAgents } from "../catalog/agent-catalog.js";
import { defaultFeatureIds, featureCatalog } from "../catalog/feature-catalog.js";
import { destinationForScope, type HostScan, scanHost } from "../config/host-scan.js";
import { install } from "../install/install.js";
import { receiptPath } from "../install/install-paths.js";
import { toInstallError } from "../install/install-request.js";
import { preparePackage } from "../install/prepare-package.js";
import { readReceipt } from "../install/receipt.js";
import { uninstall } from "../install/uninstall.js";
import { update } from "../install/update.js";
import { copyWorkflows } from "../workflows/copy-workflows.js";
import { showFeatureList } from "./catalog-command.js";
import { checkBothScopes, showScopeHealth } from "./doctor-command.js";
import { showInstallation } from "./install-command.js";
import { applyIfApproved, pickScope, runConfig } from "./menu-settings.js";
import * as TerminalUI from "./terminal-ui.js";
import { showUninstallation } from "./uninstall-command.js";
import { showUpdate } from "./update-command.js";
import { showCopiedWorkflows, workflowTemplateDirectory } from "./workflow-command.js";

const agentSummary = (host: HostScan): string => {
  const detected = detectAgents(host.agentEvidence)
    .filter((agent) => agent.installed)
    .map((agent) => agent.displayName);
  return detected.length > 0 ? detected.join(", ") : "none detected";
};

const featureList = (ids: ReadonlyArray<string>) => (ids.length > 0 ? ids.join(", ") : "(none)");

const pickFeatures = (initial: ReadonlyArray<string>) =>
  TerminalUI.multiSelect({
    message: "Select features (space toggles, enter confirms)",
    choices: featureCatalog.map((feature) => ({
      title: feature.title,
      value: feature.id,
      description: `${feature.id} · ${feature.summary}`,
      selected: initial.includes(feature.id),
    })),
    initial,
  });

const pickDestination = (verb: string) =>
  Effect.gen(function* () {
    const scope = yield* pickScope(verb);
    const host = yield* Effect.tryPromise({ try: () => scanHost(), catch: (error) => error });
    const destination = destinationForScope({ scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot });
    return { scope, host, destination };
  });

const runInstall = Effect.gen(function* () {
  const { scope, host, destination } = yield* pickDestination("Install");
  const features = yield* pickFeatures(defaultFeatureIds);
  yield* applyIfApproved({
    title: "Install plan",
    steps: [
      { label: "Action", detail: "add features + hooks; installed features are kept" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      { label: "Features", detail: featureList(features) },
      { label: "Agents", detail: `${agentSummary(host)} (auto-detected)` },
      { label: "Config", detail: "automatic (reuse / inherit / defaults)" },
    ],
    confirmMessage: "Apply this install plan?",
    apply: Effect.gen(function* () {
      const installation = yield* install({
        destination,
        host: { homeRoot: host.homeRoot },
        preparedPackage: yield* preparePackage,
        features: { _tag: "selected", ids: features },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "interactive" },
        configuration: { _tag: "automatic" },
      });
      yield* showInstallation(installation);
    }),
  });
});

const runUpdate = Effect.gen(function* () {
  const { scope, host, destination } = yield* pickDestination("Update");
  const mode = yield* TerminalUI.selectOne<"preserve" | "selected">({
    message: "Feature selection",
    choices: [
      { title: "Preserve installed set", value: "preserve", description: "refresh payload only" },
      { title: "Choose features", value: "selected", description: "unticked installed features are removed" },
    ],
    initial: "preserve",
  });
  const path = yield* Path.Path;
  const receiptSnapshot = yield* Effect.tryPromise({
    try: () => readReceipt(path.join(destination.root, receiptPath)),
    catch: toInstallError,
  });
  const installedIds = receiptSnapshot._tag === "present" ? receiptSnapshot.receipt.features : defaultFeatureIds;
  const features = yield* mode === "preserve"
    ? Effect.succeed({ _tag: "preserve" as const })
    : pickFeatures(installedIds).pipe(Effect.map((ids) => ({ _tag: "selected" as const, ids })));
  yield* applyIfApproved({
    title: "Update plan",
    steps: [
      { label: "Action", detail: "update / refresh installation" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      {
        label: "Features",
        detail: features._tag === "preserve" ? "preserve receipt selection" : featureList(features.ids),
      },
      { label: "Agents", detail: `${agentSummary(host)} (auto-detected)` },
      { label: "Config", detail: "automatic" },
    ],
    confirmMessage: "Apply this update plan?",
    apply: Effect.gen(function* () {
      const updateSummary = yield* update({
        destination,
        host: { homeRoot: host.homeRoot },
        preparedPackage: yield* preparePackage,
        features,
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "interactive" },
        configuration: { _tag: "automatic" },
      });
      yield* showUpdate(updateSummary);
    }),
  });
});

const runUninstall = Effect.gen(function* () {
  const { scope, host, destination } = yield* pickDestination("Uninstall");
  yield* applyIfApproved({
    title: "Uninstall plan",
    steps: [
      { label: "Action", detail: "remove receipt-owned installation" },
      { label: "Scope", detail: scope },
      { label: "Destination", detail: destination.root },
      { label: "Safety", detail: "only receipt-authorized files are removed" },
    ],
    confirmMessage: `Uninstall agent-setup from ${scope}?`,
    apply: uninstall({ destination, host: { homeRoot: host.homeRoot }, interaction: { _tag: "interactive" } }).pipe(
      Effect.flatMap(showUninstallation),
    ),
  });
});

const runWorkflow = Effect.gen(function* () {
  const path = yield* Path.Path;
  const workspace = yield* TerminalUI.optionalText({
    message: "Target workspace (repository root)",
    fallback: path.resolve(process.cwd()),
  });
  const targetRoot = path.resolve(workspace);
  const overwrite = yield* TerminalUI.confirm({ message: "Overwrite existing workflow files?", initialValue: false });
  const templateDirectory = yield* workflowTemplateDirectory;
  yield* applyIfApproved({
    title: "Workflow scaffold plan",
    steps: [
      { label: "Action", detail: "copy CI + publish workflow templates" },
      { label: "Workspace", detail: targetRoot },
      { label: "Overwrite", detail: overwrite ? "yes" : "no (skip existing)" },
      { label: "Templates", detail: templateDirectory },
    ],
    confirmMessage: "Apply this workflow scaffold plan?",
    apply: Effect.tryPromise({
      try: () => copyWorkflows({ targetRoot, templateDirectory, force: overwrite }),
      catch: (error) => error,
    }).pipe(Effect.flatMap(showCopiedWorkflows)),
  });
});

const screens = {
  install: runInstall,
  update: runUpdate,
  uninstall: runUninstall,
  config: runConfig,
  doctor: checkBothScopes.pipe(Effect.flatMap((scopes) => Effect.forEach(scopes, showScopeHealth))),
  catalog: TerminalUI.intro("catalog").pipe(Effect.zipRight(showFeatureList)),
  workflow: runWorkflow,
};

export const menuCommand = Command.make("menu", {}, () =>
  Effect.gen(function* () {
    yield* TerminalUI.intro("menu");
    const action = yield* TerminalUI.selectOne<keyof typeof screens | "exit">({
      message: "What would you like to do?",
      choices: [
        { title: "Install", value: "install", description: "features + hooks (plan → approve)" },
        { title: "Update", value: "update", description: "refresh installation" },
        { title: "Uninstall", value: "uninstall", description: "remove receipt-owned install" },
        { title: "Configure", value: "config", description: "show / set / reset" },
        { title: "Doctor", value: "doctor", description: "read-only health check" },
        { title: "Catalog", value: "catalog", description: "list feature IDs" },
        { title: "Workflow scaffold", value: "workflow", description: "CI + publish templates" },
        { title: "Exit", value: "exit", description: "close the menu" },
      ],
      initial: "install",
    });
    if (action === "exit") {
      yield* TerminalUI.outro("Closed.");
      return;
    }

    yield* screens[action];
    yield* TerminalUI.outro("Done.");
  }),
).pipe(
  Command.withDescription("Interactive TUI: same options as CLI args, ordered plan preview, approve before apply"),
);
