import type { Command } from "commander";

import { readDestinationForScope, scanHost } from "#src/config/host-scan.js";
import { uninstall } from "#src/install/uninstall.js";
import {
  confirmDestructive,
  createCommand,
  formatOption,
  type ScopeYesSettings,
  scopeOption,
  yesOption,
} from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

interface UninstallSummary {
  readonly _tag: "uninstalled" | "absent";
  readonly scope: string;
}

export const showUninstallation = async (uninstallation: UninstallSummary): Promise<void> => {
  const isUninstalledNow = uninstallation._tag === "uninstalled";
  await TerminalUI.runSuccess(
    isUninstalledNow
      ? `Uninstalled ${uninstallation.scope} installation.`
      : `No ${uninstallation.scope} installation present.`,
  );
};

export const createUninstallCommand = (abortSignal: AbortSignal): Command =>
  createCommand("uninstall")
    .description("Remove the receipt-owned installation from one scope")
    .addOption(scopeOption)
    .addOption(yesOption)
    .addOption(formatOption)
    .action(async (settings: ScopeYesSettings) => {
      const isPlainFormat = settings.format === "text";
      const isDocumentFormat = settings.format === "json";

      if (isPlainFormat) {
        await TerminalUI.runIntro("uninstall");
      }

      const isConfirmed = await confirmDestructive({
        yes: settings.yes,
        question: `Uninstall agent-setup from ${settings.scope} scope?`,
        missingYesIssue: "Non-interactive uninstall requires --yes.",
      });

      const isDeclined = !isConfirmed;

      if (isDeclined) {
        await TerminalUI.showCancelled(settings);
        return;
      }

      const host = await scanHost();
      const isYesGiven = settings.yes;
      const interaction = isYesGiven ? { _tag: "scripted" } : { _tag: "interactive" };
      const uninstallation = await uninstall(
        {
          destination: readDestinationForScope({
            scope: settings.scope,
            homeRoot: host.homeRoot,
            projectRoot: host.projectRoot,
          }),
          host: { homeRoot: host.homeRoot },
          interaction,
        },
        abortSignal,
      );

      if (isDocumentFormat) {
        await TerminalUI.showDocument(uninstallation);
        return;
      }

      await showUninstallation(uninstallation);
      await TerminalUI.runOutro("Done.");
    });
