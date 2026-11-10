import { configSettings, defaultSettingValue, withSettingValue } from "../config/config-schema.js";
import { locateConfigTarget, readConfig, saveConfig } from "../config/scope-config.js";
import type { Scope } from "../install/receipt.js";
import { type ConfigSetting, formatSettingValue, showConfig, withSettingText } from "./config-command.js";
import * as TerminalUI from "./terminal-ui.js";

export const pickScope = (verb: string): Promise<Scope> =>
  TerminalUI.selectOne<Scope>({
    message: `${verb} — which scope?`,
    choices: [
      { label: "global", value: "global", hint: "home root · every session" },
      { label: "project", value: "project", hint: "this repo · committable" },
    ],
    initial: "global",
  });

// Shows the plan and runs `apply` only once the user approves it.
export const applyIfApproved = async (request: {
  readonly title: string;
  readonly steps: ReadonlyArray<{ readonly label: string; readonly detail: string }>;
  readonly confirmMessage: string;
  readonly apply: () => Promise<void>;
}): Promise<void> => {
  const isApproved = await TerminalUI.confirmPlan(request);
  if (isApproved) {
    await request.apply();
    return;
  }

  await TerminalUI.showCancelledOutro();
};

// Literal settings offer their schema values; an optional setting also offers "" to clear it.
const settingChoices = (setting: ConfigSetting): ReadonlyArray<string> =>
  setting.optional && setting.choices.length > 0 ? [...setting.choices, ""] : setting.choices;

const pickSetting = (message: string): Promise<ConfigSetting> =>
  TerminalUI.selectOne<ConfigSetting>({
    message,
    choices: configSettings.map((setting) => ({ label: setting.name, value: setting, hint: setting.label })),
    initial: configSettings[0],
  });

const promptSettingValue = async (request: {
  readonly setting: ConfigSetting;
  readonly current: string;
}): Promise<string> => {
  const { setting, current } = request;
  const choices = settingChoices(setting);
  const isThereNoChoice = choices.length === 0;
  if (isThereNoChoice) {
    const numberHint = setting.kind === "number" ? " (number)" : "";
    return TerminalUI.optionalText({ message: `Value for ${setting.name}${numberHint}`, fallback: current });
  }

  return TerminalUI.selectOne({
    message: `Value for ${setting.name}`,
    choices: choices.map((value) => ({
      label: value === "" ? "(not set)" : value,
      value,
      hint: value === current ? "current" : undefined,
    })),
    initial: choices.includes(current) ? current : choices[0],
  });
};

const pickAllOrOne = (request: { readonly message: string; readonly initial: "all" | "one" }): Promise<"all" | "one"> =>
  TerminalUI.selectOne<"all" | "one">({
    message: request.message,
    choices: [
      { label: "All settings", value: "all" },
      { label: "One setting", value: "one" },
    ],
    initial: request.initial,
  });

const pickSettingForShow = async (mode: "all" | "one"): Promise<ConfigSetting | null> => {
  const isAllSettings = mode === "all";
  if (isAllSettings) {
    return null;
  }

  return pickSetting("Setting");
};

const runConfigShow = async (): Promise<void> => {
  const scope = await pickScope("Config show");
  const mode = await pickAllOrOne({ message: "Show", initial: "all" });
  const setting = await pickSettingForShow(mode);
  await showConfig({ scope, setting, format: "text" });
};

const runConfigSet = async (abortSignal: AbortSignal): Promise<void> => {
  const scope = await pickScope("Config set");
  const setting = await pickSetting("Setting to change");
  const current = await readConfig(scope);
  const currentValue = formatSettingValue({ config: current.config, setting });
  const typedAnswer = await promptSettingValue({ setting, current: currentValue });
  const nextConfig = withSettingText({ config: current.config, setting, typedAnswer });
  const nextValue = formatSettingValue({ config: nextConfig, setting });

  await applyIfApproved({
    title: "Config set plan",
    steps: [
      { label: "Action", detail: "set managed setting" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: setting.name },
      { label: "From", detail: currentValue },
      { label: "To", detail: nextValue },
      { label: "Path", detail: current.configPath },
    ],
    confirmMessage: "Apply this config change?",
    apply: async () => {
      const owner = await saveConfig(
        { target: current, configuration: { _tag: "selected", config: nextConfig } },
        abortSignal,
      );
      await TerminalUI.success(`${setting.label} → ${nextValue} (${owner})`);
    },
  });
};

const runConfigResetAll = async (scope: Scope, abortSignal: AbortSignal): Promise<void> => {
  // A full reset never reads the old file, so it also repairs a config.json that no longer decodes.
  const target = await locateConfigTarget(scope);
  await applyIfApproved({
    title: "Config reset plan",
    steps: [
      { label: "Action", detail: "reset all settings" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: "every setting" },
      { label: "To", detail: "Schema defaults" },
      { label: "Path", detail: target.configPath },
    ],
    confirmMessage: "Apply this config reset?",
    apply: async () => {
      await saveConfig({ target, configuration: { _tag: "reset" } }, abortSignal);
      await TerminalUI.success(`All ${scope} settings reset.`);
    },
  });
};

const runConfigResetOne = async (scope: Scope, abortSignal: AbortSignal): Promise<void> => {
  const current = await readConfig(scope);
  const setting = await pickSetting("Setting to reset");
  const nextConfig = withSettingValue({
    config: current.config,
    key: setting.key,
    value: defaultSettingValue(setting.key),
  });
  const nextValue = formatSettingValue({ config: nextConfig, setting });

  await applyIfApproved({
    title: "Config reset plan",
    steps: [
      { label: "Action", detail: "reset one setting" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: setting.name },
      { label: "From", detail: formatSettingValue({ config: current.config, setting }) },
      { label: "To", detail: nextValue },
      { label: "Path", detail: current.configPath },
    ],
    confirmMessage: "Apply this config reset?",
    apply: async () => {
      await saveConfig({ target: current, configuration: { _tag: "selected", config: nextConfig } }, abortSignal);
      await TerminalUI.success(`${setting.name} reset to ${nextValue}`);
    },
  });
};

const runConfigReset = async (abortSignal: AbortSignal): Promise<void> => {
  const scope = await pickScope("Config reset");
  const resetMode = await pickAllOrOne({ message: "Reset", initial: "one" });
  const isResetAll = resetMode === "all";
  if (isResetAll) {
    await runConfigResetAll(scope, abortSignal);
    return;
  }

  await runConfigResetOne(scope, abortSignal);
};

export const runConfig = async (abortSignal: AbortSignal): Promise<void> => {
  const action = await TerminalUI.selectOne<"show" | "set" | "reset" | "back">({
    message: "Config",
    choices: [
      { label: "Show", value: "show", hint: "inspect managed settings" },
      { label: "Set", value: "set", hint: "change one setting" },
      { label: "Reset", value: "reset", hint: "restore Schema defaults" },
      { label: "Back", value: "back" },
    ],
    initial: "show",
  });

  switch (action) {
    case "show":
      await runConfigShow();
      return;
    case "set":
      await runConfigSet(abortSignal);
      return;
    case "reset":
      await runConfigReset(abortSignal);
      return;
    case "back":
      return;
  }
};
