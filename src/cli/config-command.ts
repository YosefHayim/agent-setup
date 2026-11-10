import { Argument, type Command } from "commander";
import { ZodError } from "zod";

import {
  type Config,
  configSettings,
  defaultConfig,
  defaultSettingValue,
  settingValueFromText,
  withSettingValue,
} from "#src/config/config-schema.js";
import { locateConfigTarget, readConfig, saveConfig } from "#src/config/scope-config.js";
import type { Scope } from "#src/install/receipt.js";
import { joinZodIssueMessages } from "#src/zod-issue-messages.js";
import {
  confirmDestructive,
  createCliUsageError,
  createCommand,
  formatOption,
  type OutputFormat,
  type ScopeOptions,
  type ScopeYesOptions,
  scopeOption,
  yesOption,
} from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

export type ConfigSetting = (typeof configSettings)[number];

const settingNames = configSettings.map((setting) => setting.name);

// A rejected setting value is bad usage (exit 2), shown as zod's own messages.
const describeSettingRejection = (error: unknown): string => {
  const isZodRejection = error instanceof ZodError;
  if (isZodRejection) {
    return joinZodIssueMessages(error);
  }

  return String(error);
};

const findConfigSetting = (settingName: string): ConfigSetting => {
  const setting = configSettings.find((candidate) => candidate.name === settingName);
  if (setting == null) {
    throw new Error(`Unknown managed setting: ${settingName}`);
  }

  return setting;
};

// Parses the typed text and returns the config with that value; a bad value is bad usage.
export const withSettingText = (request: {
  readonly config: Config;
  readonly setting: ConfigSetting;
  readonly typedAnswer: string;
}): Config => {
  try {
    const parsedSetting = settingValueFromText({ setting: request.setting, text: request.typedAnswer });
    return withSettingValue({ config: request.config, key: request.setting.key, value: parsedSetting });
  } catch (error) {
    throw createCliUsageError(describeSettingRejection(error));
  }
};

export const formatSettingValue = (request: { readonly config: Config; readonly setting: ConfigSetting }): string => {
  const configuredSetting: unknown = request.config[request.setting.key];
  const isSettingNotSet = configuredSetting == null;
  if (isSettingNotSet) {
    return "(not set)";
  }

  return Array.isArray(configuredSetting) ? configuredSetting.join(", ") : String(configuredSetting);
};

const showOneSetting = async (request: {
  readonly scope: Scope;
  readonly config: Config;
  readonly setting: ConfigSetting;
  readonly format: OutputFormat;
}): Promise<void> => {
  const { config, setting } = request;
  const isJsonFormat = request.format === "json";
  if (isJsonFormat) {
    await TerminalUI.showDocument({ scope: request.scope, setting: setting.name, value: config[setting.key] });
    return;
  }

  await TerminalUI.note(`${setting.label}  ${formatSettingValue({ config, setting })}`, "managed config");
};

const showAllSettings = async (config: Config): Promise<void> => {
  const lines = configSettings.map(
    (setting) => `${setting.label.padEnd(40)} ${formatSettingValue({ config, setting })}`,
  );
  await TerminalUI.note(lines.join("\n"), "managed config");
};

export const showConfig = async (request: {
  readonly scope: Scope;
  readonly setting: ConfigSetting | null;
  readonly format: OutputFormat;
}): Promise<void> => {
  const { config } = await readConfig(request.scope);
  const { setting } = request;
  if (setting != null) {
    await showOneSetting({ scope: request.scope, config, setting, format: request.format });
    return;
  }

  const isJsonFormat = request.format === "json";
  if (isJsonFormat) {
    await TerminalUI.showDocument({ scope: request.scope, config });
    return;
  }

  await showAllSettings(config);
};

const createSettingArgument = (argumentSyntax: "<setting>" | "[setting]"): Argument =>
  new Argument(argumentSyntax, "Managed setting name").choices(settingNames);

const createShowCommand = (): Command =>
  createCommand("show")
    .description("Show all settings or one named setting")
    .addArgument(createSettingArgument("[setting]"))
    .addOption(scopeOption)
    .addOption(formatOption)
    .action(async (settingName: string | undefined, options: ScopeOptions) => {
      const isSettingGiven = settingName != null;
      const setting = isSettingGiven ? findConfigSetting(settingName) : null;
      await showConfig({ scope: options.scope, setting, format: options.format });
    });

const createSetCommand = (abortSignal: AbortSignal): Command =>
  createCommand("set")
    .description("Set one managed setting")
    .addArgument(createSettingArgument("<setting>"))
    .addArgument(new Argument("<value>", "New setting value"))
    .addOption(scopeOption)
    .addOption(formatOption)
    .action(async (settingName: string, typedAnswer: string, options: ScopeOptions) => {
      const setting = findConfigSetting(settingName);
      const current = await readConfig(options.scope);
      const nextConfig = withSettingText({ config: current.config, setting, typedAnswer });
      const owner = await saveConfig(
        { target: current, configuration: { _tag: "selected", config: nextConfig } },
        abortSignal,
      );

      const isTextFormat = options.format === "text";
      if (isTextFormat) {
        await TerminalUI.success(`${setting.label} → ${formatSettingValue({ config: nextConfig, setting })}`);
        return;
      }

      await TerminalUI.showDocument({
        _tag: "configured",
        scope: options.scope,
        setting: setting.name,
        value: nextConfig[setting.key],
        owner,
      });
    });

const resetEverySetting = async (request: {
  readonly options: ScopeYesOptions;
  readonly abortSignal: AbortSignal;
}): Promise<void> => {
  const { options } = request;
  const isConfirmed = await confirmDestructive({
    yes: options.yes,
    question: `Reset every ${options.scope} setting to its Schema default?`,
    missingYesIssue: "Non-interactive full config reset requires --yes.",
  });

  const isDeclined = !isConfirmed;

  if (isDeclined) {
    await TerminalUI.showCancelled(options);
    return;
  }

  const target = await locateConfigTarget(options.scope);
  const owner = await saveConfig({ target, configuration: { _tag: "reset" } }, request.abortSignal);

  const isJsonFormat = options.format === "json";
  if (isJsonFormat) {
    await TerminalUI.showDocument({ _tag: "reset", scope: options.scope, config: defaultConfig, owner });
    return;
  }

  await TerminalUI.success(`All ${options.scope} settings reset to Schema defaults.`);
};

const resetOneSetting = async (request: {
  readonly settingName: string;
  readonly options: ScopeYesOptions;
  readonly abortSignal: AbortSignal;
}): Promise<void> => {
  const { options } = request;
  const setting = findConfigSetting(request.settingName);
  const current = await readConfig(options.scope);
  const nextConfig = withSettingValue({
    config: current.config,
    key: setting.key,
    value: defaultSettingValue(setting.key),
  });
  const owner = await saveConfig(
    { target: current, configuration: { _tag: "selected", config: nextConfig } },
    request.abortSignal,
  );

  const isJsonFormat = options.format === "json";
  if (isJsonFormat) {
    await TerminalUI.showDocument({
      _tag: "reset",
      scope: options.scope,
      setting: setting.name,
      config: nextConfig,
      owner,
    });
    return;
  }

  await TerminalUI.success(`${setting.label} reset to ${formatSettingValue({ config: nextConfig, setting })}`);
};

const createResetCommand = (abortSignal: AbortSignal): Command =>
  createCommand("reset")
    .description("Reset one setting or every setting to Schema defaults")
    .addArgument(createSettingArgument("[setting]"))
    .addOption(scopeOption)
    .addOption(yesOption)
    .addOption(formatOption)
    .action(async (settingName: string | undefined, options: ScopeYesOptions) => {
      const isEverySettingReset = settingName == null;
      if (isEverySettingReset) {
        await resetEverySetting({ options, abortSignal });
        return;
      }

      await resetOneSetting({ settingName, options, abortSignal });
    });

export const createConfigCommand = (abortSignal: AbortSignal): Command =>
  createCommand("config")
    .description("Inspect or change managed configuration")
    .addCommand(createShowCommand())
    .addCommand(createSetCommand(abortSignal))
    .addCommand(createResetCommand(abortSignal));
