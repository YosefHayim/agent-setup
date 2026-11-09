/** `agent-setup install [feature-id...]` — add features to the installed selection. */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { destinationForScope, scanHost } from "../config/host-scan.js";
import { install } from "../install/install.js";
import { preparePackage } from "../install/prepare-package.js";
import { featureIdsArgument, formatOption, scopeOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export const showInstallation = (installation: {
  readonly _tag: "installed" | "unchanged";
  readonly scope: string;
  readonly features: ReadonlyArray<string>;
  readonly agents: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const features = `${installation.features.join(", ")} (${installation.scope})`;
    yield* TerminalUI.success(
      installation._tag === "installed" ? `Installed ${features}` : `Already current: ${features}`,
    );
    if (installation.agents.length > 0) yield* TerminalUI.detail(`Agents: ${installation.agents.join(", ")}`);
  });

export const installCommand = Command.make(
  "install",
  {
    featureIds: featureIdsArgument("Feature IDs from `agent-setup catalog` to add; omitted adds catalog defaults"),
    scope: scopeOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      if (args.format === "text") yield* TerminalUI.intro("install");
      const host = yield* scanHost;
      const installation = yield* install({
        destination: destinationForScope({ scope: args.scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        host: { homeRoot: host.homeRoot },
        preparedPackage: yield* preparePackage,
        features: args.featureIds.length === 0 ? { _tag: "defaults" } : { _tag: "selected", ids: args.featureIds },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      });
      if (args.format === "json") {
        yield* TerminalUI.json(installation);
        return;
      }

      yield* showInstallation(installation);
      yield* TerminalUI.outro("Done.");
    }),
).pipe(Command.withDescription("Add catalog defaults or the named features; installed features are kept"));
