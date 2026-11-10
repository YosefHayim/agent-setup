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
    yield* Effect.tryPromise({
      try: () =>
        TerminalUI.success(
          installation._tag === "installed" ? `Installed ${features}` : `Already current: ${features}`,
        ),
      catch: (error) => error,
    });

    const hasAgents = installation.agents.length > 0;
    if (hasAgents) {
      yield* Effect.tryPromise({
        try: () => TerminalUI.detail(`Agents: ${installation.agents.join(", ")}`),
        catch: (error) => error,
      });
    }
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
      const isTextFormat = args.format === "text";
      if (isTextFormat) {
        yield* Effect.tryPromise({ try: () => TerminalUI.intro("install"), catch: (error) => error });
      }
      const host = yield* Effect.tryPromise({ try: () => scanHost(), catch: (error) => error });
      const preparedPackage = yield* Effect.tryPromise({ try: preparePackage, catch: (error) => error });
      const installRequest = {
        destination: destinationForScope({ scope: args.scope, homeRoot: host.homeRoot, projectRoot: host.projectRoot }),
        host: { homeRoot: host.homeRoot },
        preparedPackage,
        features: args.featureIds.length === 0 ? { _tag: "defaults" } : { _tag: "selected", ids: args.featureIds },
        agents: { _tag: "detected", evidence: host.agentEvidence },
        interaction: { _tag: "scripted" },
        configuration: { _tag: "automatic" },
      };
      const installation = yield* Effect.tryPromise({
        try: (signal) => install(installRequest, signal),
        catch: (error) => error,
      });
      if (args.format === "json") {
        yield* Effect.tryPromise({ try: () => TerminalUI.showDocument(installation), catch: (error) => error });
        return;
      }

      yield* showInstallation(installation);
      yield* Effect.tryPromise({ try: () => TerminalUI.outro("Done."), catch: (error) => error });
    }),
).pipe(Command.withDescription("Add catalog defaults or the named features; installed features are kept"));
