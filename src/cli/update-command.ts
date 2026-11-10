/** `agent-setup update [feature-id...]` — refresh every installed feature and keep the receipt selection. */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { destinationForScope, scanHost } from "../config/host-scan.js";
import { preparePackage } from "../install/prepare-package.js";
import { update } from "../install/update.js";
import { featureIdsArgument, formatOption, scopeOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export const showUpdate = (updateSummary: {
  readonly _tag: "updated" | "unchanged";
  readonly scope: string;
  readonly features: ReadonlyArray<string>;
}) => {
  const features = `${updateSummary.features.join(", ")} (${updateSummary.scope})`;
  return Effect.tryPromise({
    try: () =>
      TerminalUI.success(updateSummary._tag === "updated" ? `Updated ${features}` : `Already current: ${features}`),
    catch: (error) => error,
  });
};

export const updateCommand = Command.make(
  "update",
  {
    featureIds: featureIdsArgument("Feature IDs that must already be installed; the whole installation is refreshed"),
    scope: scopeOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      const isTextFormat = args.format === "text";
      if (isTextFormat) {
        yield* Effect.tryPromise({ try: () => TerminalUI.intro("update"), catch: (error) => error });
      }
      const host = yield* Effect.tryPromise({ try: () => scanHost(), catch: (error) => error });
      const updateSummary = yield* update({
        destination: destinationForScope({ scope: args.scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        host: { homeRoot: host.homeRoot },
        preparedPackage: yield* Effect.tryPromise({ try: preparePackage, catch: (error) => error }),
        features: args.featureIds.length === 0 ? { _tag: "preserve" } : { _tag: "refresh", ids: args.featureIds },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      });
      if (args.format === "json") {
        yield* Effect.tryPromise({ try: () => TerminalUI.showDocument(updateSummary), catch: (error) => error });
        return;
      }

      yield* showUpdate(updateSummary);
      yield* Effect.tryPromise({ try: () => TerminalUI.outro("Done."), catch: (error) => error });
    }),
).pipe(Command.withDescription("Refresh every installed feature and keep the receipt selection"));
