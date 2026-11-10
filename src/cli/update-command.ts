import type { Command } from "commander";

import { destinationForScope, scanHost } from "#src/config/host-scan.js";
import { preparePackage } from "#src/install/prepare-package.js";
import { update } from "#src/install/update.js";
import { createCommand, featureIdsArgument, formatOption, type ScopeOptions, scopeOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

interface UpdateSummary {
  readonly _tag: "updated" | "unchanged";
  readonly scope: string;
  readonly features: ReadonlyArray<string>;
}

export const showUpdate = async (updateSummary: UpdateSummary): Promise<void> => {
  const features = `${updateSummary.features.join(", ")} (${updateSummary.scope})`;
  const isUpdatedNow = updateSummary._tag === "updated";
  await TerminalUI.success(isUpdatedNow ? `Updated ${features}` : `Already current: ${features}`);
};

export const createUpdateCommand = (abortSignal: AbortSignal): Command =>
  createCommand("update")
    .description("Refresh every installed feature and keep the receipt selection")
    .addArgument(featureIdsArgument("Feature IDs that must already be installed; the whole installation is refreshed"))
    .addOption(scopeOption)
    .addOption(formatOption)
    .action(async (featureIds: ReadonlyArray<string>, options: ScopeOptions) => {
      const isJsonFormat = options.format === "json";
      const isTextFormat = options.format === "text";

      if (isTextFormat) {
        await TerminalUI.intro("update");
      }

      const host = await scanHost();
      const destination = destinationForScope({
        scope: options.scope,
        homeRoot: host.homeRoot,
        projectRoot: host.projectRoot,
      });
      const preparedPackage = await preparePackage();
      const isNoFeatureGiven = featureIds.length === 0;
      const featureChoice = isNoFeatureGiven ? { _tag: "preserve" } : { _tag: "refresh", ids: featureIds };
      const updateSummary = await update(
        {
          destination,
          host: { homeRoot: host.homeRoot },
          preparedPackage,
          features: featureChoice,
          agents: { _tag: "detected", evidence: host.agentEvidence },
          interaction: { _tag: "scripted" },
          configuration: { _tag: "automatic" },
        },
        abortSignal,
      );

      if (isJsonFormat) {
        await TerminalUI.showDocument(updateSummary);
        return;
      }

      await showUpdate(updateSummary);
      await TerminalUI.outro("Done.");
    });
