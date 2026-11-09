/** `agent-setup catalog` — list the public feature IDs accepted by install and update. */

import { Command } from "@effect/cli";
import { Effect } from "effect";

import { featureCatalog } from "../catalog/feature-catalog.js";
import { formatOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export const showFeatureList = TerminalUI.note(
  featureCatalog
    .map(
      (feature) =>
        `${feature.id.padEnd(24)} ${feature.title}${feature.selectedByDefault ? " · default" : ""}\n${"".padEnd(26)}${feature.summary}`,
    )
    .join("\n"),
  "Features",
);

export const catalogCommand = Command.make("catalog", { format: formatOption }, (args) =>
  Effect.gen(function* () {
    if (args.format === "json") {
      yield* TerminalUI.json({
        features: featureCatalog.map(({ id, title, summary, selectedByDefault, platform }) => ({
          id,
          title,
          summary,
          selectedByDefault,
          platform,
        })),
      });
      return;
    }

    yield* TerminalUI.intro("catalog");
    yield* showFeatureList;
    yield* TerminalUI.outro("Install with `agent-setup install <feature-id>...`.");
  }),
).pipe(Command.withDescription("List installable feature IDs and catalog defaults"));
