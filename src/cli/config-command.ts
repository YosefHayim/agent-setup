import { Argument, type Command } from "commander";
import { ZodError } from "zod";

import {
  type Config,
  defaultSettings,
  readDefaultSettingField,
  readSettingFieldFromString,
  setSettingField,
  settingList,
} from "#src/config/config-schema.js";
import { readLocateSettingsTarget, readSettings, saveSettings } from "#src/config/scope-config.js";
import type { Scope } from "#src/install/receipt.js";
import { joinZodIssueMessages } from "#src/zod-issue-messages.js";
import {
  confirmDestructive,
  createCliUsageError,
  createCommand,
  formatOption,
  type PrintFormat,
  type ScopeSettings,
  type ScopeYesSettings,
  scopeOption,
  yesOption,
} from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export type Setting = (typeof settingList)[number];

const settingNames = settingList.map((setting) => setting.name);

// A rejected setting value is bad usage (exit 2), shown as zod's own messages.
const describeSettingRejection = (error: unknown): string => {
  const isZodRejection = error instanceof ZodError;
  if (isZodRejection) {
    return joinZodIssueMessages(error);
  }

  return String(error);
};

const findSettingsSetting = (settingName: string): Setting => {
  const setting = settingList.find((candidate) => candidate.name === settingName);

  const isSettingMissing = setting == null;
  if (isSettingMissing) {
    throw new Error(`Unknown managed setting: ${settingName}`);
  }

  return setting;
};

// Parses the typed text and returns the config with that value; a bad value is bad usage.
export const setSettingFromString = (request: {
  readonly config: Config;
  readonly setting: Setting;
  readonly typedAnswer: string;
}): Config => {
  try {
    const parsedSetting = readSettingFieldFromString({ setting: request.setting, text: request.typedAnswer });
    return setSettingField({ config: request.config, key: request.setting.key, value: parsedSetting });
  } catch (error) {
    throw createCliUsageError(describeSettingRejection(error));
  }
};

export const createSettingDisplay = (request: { readonly config: Config; readonly setting: Setting }): string => {
  const configuredSetting: unknown = request.config[request.setting.key];

  const isSettingNotSet = configuredSetting == null;
  if (isSettingNotSet) {
    return "(not set)";
  }

  const isListSetting = Array.isArray(configuredSetting);

  return isListSetting ? configuredSetting.join(", ") : String(configuredSetting);
};

const showOneSetting = async (request: {
  readonly scope: Scope;
  readonly config: Config;
  readonly setting: Setting;
  readonly format: PrintFormat;
}): Promise<void> => {
  const { config: settings, setting } = request;

  const isDocumentFormat = request.format === "json";
  if (isDocumentFormat) {
    await TerminalUI.showDocument({ scope: request.scope, setting: setting.name, value: settings[setting.key] });
    return;
  }

  await TerminalUI.note(`${setting.label}  ${createSettingDisplay({ config: settings, setting })}`, "managed config");
};

const showAllSettings = async (settings: Config): Promise<void> => {
  const lines = settingList.map(
    (setting) => `${setting.label.padEnd(40)} ${createSettingDisplay({ config: settings, setting })}`,
  );
  await TerminalUI.note(lines.join("\n"), "managed config");
};

export const showSettings = async (request: {
  readonly scope: Scope;
  readonly setting: Setting | null;
  readonly format: PrintFormat;
}): Promise<void> => {
  const { config: settings } = await readSettings(request.scope);
  const { setting } = request;

  const hasSetting = setting != null;
  if (hasSetting) {
    await showOneSetting({ scope: request.scope, config: settings, setting, format: request.format });
    return;
  }

  const isDocumentFormat = request.format === "json";
  if (isDocumentFormat) {
    await TerminalUI.showDocument({ scope: request.scope, config: settings });
    return;
  }

  await showAllSettings(settings);
};

const createSettingArgument = (argumentSyntax: "<setting>" | "[setting]"): Argument =>
  new Argument(argumentSyntax, "Managed setting name").choices(settingNames);

const createShowCommand = (): Command =>
  createCommand("show")
    .description("Show all settings or one named setting")
    .addArgument(createSettingArgument("[setting]"))
    .addOption(scopeOption)
    .addOption(formatOption)
    .action(async (settingName: string | undefined, settings: ScopeSettings) => {
      const isSettingGiven = settingName != null;
      const setting = isSettingGiven ? findSettingsSetting(settingName) : null;
      await showSettings({ scope: settings.scope, setting, format: settings.format });
    });

const createSetCommand = (abortSignal: AbortSignal): Command =>
  createCommand("set")
    .description("Set one managed setting")
    .addArgument(createSettingArgument("<setting>"))
    .addArgument(new Argument("<value>", "New setting value"))
    .addOption(scopeOption)
    .addOption(formatOption)
    .action(async (settingName: string, typedAnswer: string, settings: ScopeSettings) => {
      const setting = findSettingsSetting(settingName);
      const current = await readSettings(settings.scope);
      const nextSettings = setSettingFromString({ config: current.config, setting, typedAnswer });
      const owner = await saveSettings(
        { target: current, configuration: { _tag: "selected", config: nextSettings } },
        abortSignal,
      );

      const isPlainFormat = settings.format === "text";
      if (isPlainFormat) {
        await TerminalUI.runSuccess(`${setting.label} → ${createSettingDisplay({ config: nextSettings, setting })}`);
        return;
      }

      await TerminalUI.showDocument({
        _tag: "configured",
        scope: settings.scope,
        setting: setting.name,
        value: nextSettings[setting.key],
        owner,
      });
    });

const resetEverySetting = async (request: {
  readonly options: ScopeYesSettings;
  readonly abortSignal: AbortSignal;
}): Promise<void> => {
  const { options: settings } = request;
  const isConfirmed = await confirmDestructive({
    yes: settings.yes,
    question: `Reset every ${settings.scope} setting to its Schema default?`,
    missingYesIssue: "Non-interactive full config reset requires --yes.",
  });

  const isDeclined = !isConfirmed;

  if (isDeclined) {
    await TerminalUI.showCancelled(settings);
    return;
  }

  const target = await readLocateSettingsTarget(settings.scope);
  const owner = await saveSettings({ target, configuration: { _tag: "reset" } }, request.abortSignal);

  const isDocumentFormat = settings.format === "json";
  if (isDocumentFormat) {
    await TerminalUI.showDocument({ _tag: "reset", scope: settings.scope, config: defaultSettings, owner });
    return;
  }

  await TerminalUI.runSuccess(`All ${settings.scope} settings reset to Schema defaults.`);
};

const resetOneSetting = async (request: {
  readonly settingName: string;
  readonly options: ScopeYesSettings;
  readonly abortSignal: AbortSignal;
}): Promise<void> => {
  const { options: settings } = request;
  const setting = findSettingsSetting(request.settingName);
  const current = await readSettings(settings.scope);
  const nextSettings = setSettingField({
    config: current.config,
    key: setting.key,
    value: readDefaultSettingField(setting.key),
  });
  const owner = await saveSettings(
    { target: current, configuration: { _tag: "selected", config: nextSettings } },
    request.abortSignal,
  );

  const isDocumentFormat = settings.format === "json";
  if (isDocumentFormat) {
    await TerminalUI.showDocument({
      _tag: "reset",
      scope: settings.scope,
      setting: setting.name,
      config: nextSettings,
      owner,
    });
    return;
  }

  await TerminalUI.runSuccess(`${setting.label} reset to ${createSettingDisplay({ config: nextSettings, setting })}`);
};

const createResetCommand = (abortSignal: AbortSignal): Command =>
  createCommand("reset")
    .description("Reset one setting or every setting to Schema defaults")
    .addArgument(createSettingArgument("[setting]"))
    .addOption(scopeOption)
    .addOption(yesOption)
    .addOption(formatOption)
    .action(async (settingName: string | undefined, settings: ScopeYesSettings) => {
      const isEverySettingReset = settingName == null;
      if (isEverySettingReset) {
        await resetEverySetting({ options: settings, abortSignal });
        return;
      }

      await resetOneSetting({ settingName, options: settings, abortSignal });
    });

export const createSettingsCommand = (abortSignal: AbortSignal): Command =>
  createCommand("config")
    .description("Inspect or change managed configuration")
    .addCommand(createShowCommand())
    .addCommand(createSetCommand(abortSignal))
    .addCommand(createResetCommand(abortSignal));
