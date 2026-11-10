import type { Command } from "commander";

import { featureCatalog } from "../catalog/feature-catalog.js";
import { createCommand, type FormatOptions, formatOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

const featureIdColumnWidth = 24;
const summaryIndentWidth = 26;

export const showFeatureList = (): Promise<void> =>
  TerminalUI.note(
    featureCatalog
      .map(
        (feature) =>
          `${feature.id.padEnd(featureIdColumnWidth)} ${feature.title}${feature.selectedByDefault ? " · default" : ""}\n${"".padEnd(summaryIndentWidth)}${feature.summary}`,
      )
      .join("\n"),
    "Features",
  );

export const createCatalogCommand = (): Command =>
  createCommand("catalog")
    .description("List installable feature IDs and catalog defaults")
    .addOption(formatOption)
    .action(async (options: FormatOptions) => {
      const isJsonFormat = options.format === "json";
      if (isJsonFormat) {
        const featureRows = featureCatalog.map(({ id, title, summary, selectedByDefault, platform }) => ({
          id,
          title,
          summary,
          selectedByDefault,
          platform,
        }));
        await TerminalUI.showDocument({ features: featureRows });
        return;
      }

      await TerminalUI.intro("catalog");
      await showFeatureList();
      await TerminalUI.outro("Install with `agent-setup install <feature-id>...`.");
    });
