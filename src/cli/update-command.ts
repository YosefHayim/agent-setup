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
  return TerminalUI.success(updateSummary._tag === "updated" ? `Updated ${features}` : `Already current: ${features}`);
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
      if (args.format === "text") yield* TerminalUI.intro("update");
      const host = yield* scanHost;
      const updateSummary = yield* update({
        destination: destinationForScope({ scope: args.scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        host: { homeRoot: host.homeRoot },
        preparedPackage: yield* preparePackage,
        features: args.featureIds.length === 0 ? { _tag: "preserve" } : { _tag: "refresh", ids: args.featureIds },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      });
      if (args.format === "json") {
        yield* TerminalUI.json(updateSummary);
        return;
      }

      yield* showUpdate(updateSummary);
      yield* TerminalUI.outro("Done.");
    }),
).pipe(Command.withDescription("Refresh every installed feature and keep the receipt selection"));
