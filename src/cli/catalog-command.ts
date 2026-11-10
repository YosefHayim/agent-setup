import type { Command } from "commander";

import { featureCatalog } from "#src/catalog/feature-catalog.js";
import { createCommand, type FormatSettings, formatOption } from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

const featureIdColumnWidth = 24;
const summaryIndentWidth = 26;

export const showFeatureList = (): Promise<void> =>
  TerminalUI.note(
    featureCatalog
      .map((feature) => {
        const isDefaultFeature = feature.selectedByDefault;
        const defaultMark = isDefaultFeature ? " · default" : "";

        return `${feature.id.padEnd(featureIdColumnWidth)} ${feature.title}${defaultMark}\n${"".padEnd(summaryIndentWidth)}${feature.summary}`;
      })
      .join("\n"),
    "Features",
  );

export const createCatalogCommand = (): Command =>
  createCommand("catalog")
    .description("List installable feature IDs and catalog defaults")
    .addOption(formatOption)
    .action(async (settings: FormatSettings) => {
      const isDocumentFormat = settings.format === "json";
      if (isDocumentFormat) {
        const storedFeatureList = featureCatalog.map(({ id, title, summary, selectedByDefault, platform }) => ({
          id,
          title,
          summary,
          selectedByDefault,
          platform,
        }));
        await TerminalUI.showDocument({ features: storedFeatureList });
        return;
      }

      await TerminalUI.runIntro("catalog");
      await showFeatureList();
      await TerminalUI.runOutro("Install with `agent-setup install <feature-id>...`.");
    });
