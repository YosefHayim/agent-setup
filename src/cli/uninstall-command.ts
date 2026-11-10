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
  Effect.tryPromise({
    try: () =>
      TerminalUI.success(
        uninstallation._tag === "uninstalled"
          ? `Uninstalled ${uninstallation.scope} installation.`
          : `No ${uninstallation.scope} installation present.`,
      ),
    catch: (error) => error,
  });

export const uninstallCommand = Command.make(
  "uninstall",
  { scope: scopeOption, yes: yesOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      const isTextFormat = args.format === "text";
      if (isTextFormat) {
        yield* Effect.tryPromise({ try: () => TerminalUI.intro("uninstall"), catch: (error) => error });
      }
      const confirmed = yield* Effect.tryPromise({
        try: () =>
          confirmDestructive({
            yes: args.yes,
            question: `Uninstall agent-setup from ${args.scope} scope?`,
            missingYesIssue: "Non-interactive uninstall requires --yes.",
          }),
        catch: (error) => error,
      });
      if (!confirmed) {
        yield* Effect.tryPromise({ try: () => TerminalUI.showCancelled(args), catch: (error) => error });
        return;
      }

      const host = yield* Effect.tryPromise({ try: () => scanHost(), catch: (error) => error });
      const uninstallation = yield* uninstall({
        destination: destinationForScope({ scope: args.scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        host: { homeRoot: host.homeRoot },
        interaction: args.yes ? { _tag: "scripted" } : { _tag: "interactive" },
      });
      if (args.format === "json") {
        yield* Effect.tryPromise({ try: () => TerminalUI.showDocument(uninstallation), catch: (error) => error });
        return;
      }

      yield* showUninstallation(uninstallation);
      yield* Effect.tryPromise({ try: () => TerminalUI.outro("Done."), catch: (error) => error });
    }),
).pipe(Command.withDescription("Remove the receipt-owned installation from one scope"));
