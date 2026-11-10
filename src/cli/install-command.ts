import type { Command } from "commander";

import { destinationForScope, scanHost } from "#src/config/host-scan.js";
import { install } from "#src/install/install.js";
import { preparePackage } from "#src/install/prepare-package.js";
import { createCommand, featureIdsArgument, formatOption, type ScopeOptions, scopeOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

interface InstallationSummary {
  readonly _tag: "installed" | "unchanged";
  readonly scope: string;
  readonly features: ReadonlyArray<string>;
  readonly agents: ReadonlyArray<string>;
}

export const showInstallation = async (installation: InstallationSummary): Promise<void> => {
  const features = `${installation.features.join(", ")} (${installation.scope})`;
  const isInstalledNow = installation._tag === "installed";
  await TerminalUI.success(isInstalledNow ? `Installed ${features}` : `Already current: ${features}`);

  const hasAgents = installation.agents.length > 0;
  if (hasAgents) {
    await TerminalUI.detail(`Agents: ${installation.agents.join(", ")}`);
  }
};

export const createInstallCommand = (abortSignal: AbortSignal): Command =>
  createCommand("install")
    .description("Add catalog defaults or the named features; installed features are kept")
    .addArgument(featureIdsArgument("Feature IDs from `agent-setup catalog` to add; omitted adds catalog defaults"))
    .addOption(scopeOption)
    .addOption(formatOption)
    .action(async (featureIds: ReadonlyArray<string>, options: ScopeOptions) => {
      const isTextFormat = options.format === "text";
      const isJsonFormat = options.format === "json";

      if (isTextFormat) {
        await TerminalUI.intro("install");
      }

      const host = await scanHost();
      const preparedPackage = await preparePackage();
      const isNoFeatureGiven = featureIds.length === 0;
      const featureChoice = isNoFeatureGiven ? { _tag: "defaults" } : { _tag: "selected", ids: featureIds };
      const installRequest = {
        destination: destinationForScope({
          scope: options.scope,
          homeRoot: host.homeRoot,
          projectRoot: host.projectRoot,
        }),
        host: { homeRoot: host.homeRoot },
        preparedPackage,
        features: featureChoice,
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      };
      const installation = await install(installRequest, abortSignal);

      if (isJsonFormat) {
        await TerminalUI.showDocument(installation);
        return;
      }

      await showInstallation(installation);
      await TerminalUI.outro("Done.");
    });
