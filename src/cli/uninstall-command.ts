import type { Command } from "commander";

import { destinationForScope, scanHost } from "../config/host-scan.js";
import { uninstall } from "../install/uninstall.js";
import {
  confirmDestructive,
  createCommand,
  formatOption,
  type ScopeYesOptions,
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
  await TerminalUI.success(
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
    .action(async (options: ScopeYesOptions) => {
      const isTextFormat = options.format === "text";
      const isJsonFormat = options.format === "json";

      if (isTextFormat) {
        await TerminalUI.intro("uninstall");
      }

      const isConfirmed = await confirmDestructive({
        yes: options.yes,
        question: `Uninstall agent-setup from ${options.scope} scope?`,
        missingYesIssue: "Non-interactive uninstall requires --yes.",
      });

      const isDeclined = !isConfirmed;

      if (isDeclined) {
        await TerminalUI.showCancelled(options);
        return;
      }

      const host = await scanHost();
      const isYesGiven = options.yes;
      const interaction = isYesGiven ? { _tag: "scripted" } : { _tag: "interactive" };
      const uninstallation = await uninstall(
        {
          destination: destinationForScope({
            scope: options.scope,
            homeRoot: host.homeRoot,
            projectRoot: host.projectRoot,
          }),
          host: { homeRoot: host.homeRoot },
          interaction,
        },
        abortSignal,
      );

      if (isJsonFormat) {
        await TerminalUI.showDocument(uninstallation);
        return;
      }

      await showUninstallation(uninstallation);
      await TerminalUI.outro("Done.");
    });
