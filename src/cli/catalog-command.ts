/** `agent-setup catalog` — list the public feature IDs accepted by install and update. */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { featureCatalog } from "../catalog/feature-catalog.js";
import { formatOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export const showFeatureList = Effect.tryPromise({
  try: () =>
    TerminalUI.note(
      featureCatalog
        .map(
          (feature) =>
            `${feature.id.padEnd(24)} ${feature.title}${feature.selectedByDefault ? " · default" : ""}\n${"".padEnd(26)}${feature.summary}`,
        )
        .join("\n"),
      "Features",
    ),
  catch: (error) => error,
});

export const catalogCommand = Command.make("catalog", { format: formatOption }, (args) =>
  Effect.gen(function* () {
    if (args.format === "json") {
      yield* Effect.tryPromise({
        try: () =>
          TerminalUI.showDocument({
            features: featureCatalog.map(({ id, title, summary, selectedByDefault, platform }) => ({
              id,
              title,
              summary,
              selectedByDefault,
              platform,
            })),
          }),
        catch: (error) => error,
      });
      return;
    }

    yield* Effect.tryPromise({ try: () => TerminalUI.intro("catalog"), catch: (error) => error });
    yield* showFeatureList;
    yield* Effect.tryPromise({
      try: () => TerminalUI.outro("Install with `agent-setup install <feature-id>...`."),
      catch: (error) => error,
    });
  }),
).pipe(Command.withDescription("List installable feature IDs and catalog defaults"));
