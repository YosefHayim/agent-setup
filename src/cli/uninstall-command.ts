/** `agent-setup uninstall` — remove only files authorized by the receipt. */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { destinationForScope, scanHost } from "../config/host-scan.js";
import { uninstall } from "../install/uninstall.js";
import { confirmDestructive, formatOption, scopeOption, yesOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export const showUninstallation = (uninstallation: {
  readonly _tag: "uninstalled" | "absent";
  readonly scope: string;
}) =>
  TerminalUI.success(
    uninstallation._tag === "uninstalled"
      ? `Uninstalled ${uninstallation.scope} installation.`
      : `No ${uninstallation.scope} installation present.`,
  );

export const uninstallCommand = Command.make(
  "uninstall",
  { scope: scopeOption, yes: yesOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("uninstall");
      const confirmed = yield* confirmDestructive({
        yes: args.yes,
        question: `Uninstall agent-setup from ${args.scope} scope?`,
        missingYesIssue: "Non-interactive uninstall requires --yes.",
      });
      if (!confirmed) {
        yield* TerminalUI.showCancelled(args);
        return;
      }

      const host = yield* scanHost;
      const uninstallation = yield* uninstall({
        destination: destinationForScope({ scope: args.scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        host: { homeRoot: host.homeRoot },
        interaction: args.yes ? { _tag: "scripted" } : { _tag: "interactive" },
      });
      if (args.format === "json") {
        yield* TerminalUI.json(uninstallation);
        return;
      }

      yield* showUninstallation(uninstallation);
      yield* TerminalUI.outro("Done.");
    }),
).pipe(Command.withDescription("Remove the receipt-owned installation from one scope"));
