import { readDefaultSettingField, setSettingField, settingList } from "#src/config/config-schema.js";
import { readLocateSettingsTarget, readSettings, saveSettings } from "#src/config/scope-config.js";
import type { Scope } from "#src/install/receipt.js";
import { createSettingDisplay, type Setting, setSettingFromString, showSettings } from "./config-command.js";
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
const listSettingChoices = (setting: Setting): ReadonlyArray<string> => {
  const isClearableSetting = setting.optional && setting.choices.length > 0;

  if (isClearableSetting) {
    return [...setting.choices, ""];
  }

  return setting.choices;
};

const pickSetting = (message: string): Promise<Setting> =>
  TerminalUI.selectOne<Setting>({
    message,
    choices: settingList.map((setting) => ({ label: setting.name, value: setting, hint: setting.label })),
    initial: settingList[0],
  });

const readPromptSettingField = async (request: {
  readonly setting: Setting;
  readonly current: string;
}): Promise<string> => {
  const { setting, current } = request;
  const choices = listSettingChoices(setting);

  const isThereNoChoice = choices.length === 0;
  if (isThereNoChoice) {
    const isNumberSetting = setting.kind === "number";
    const numberHint = isNumberSetting ? " (number)" : "";
    return TerminalUI.readOptionalString({ message: `Value for ${setting.name}${numberHint}`, fallback: current });
  }

  const isCurrentChoiceListed = choices.includes(current);

  return TerminalUI.selectOne({
    message: `Value for ${setting.name}`,
    choices: choices.map((field) => {
      const isClearChoice = field === "";
      const isCurrentChoice = field === current;

      return {
        label: isClearChoice ? "(not set)" : field,
        value: field,
        hint: isCurrentChoice ? "current" : undefined,
      };
    }),
    initial: isCurrentChoiceListed ? current : choices[0],
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

const pickSettingForShow = async (mode: "all" | "one"): Promise<Setting | null> => {
  const isAllSettings = mode === "all";
  if (isAllSettings) {
    return null;
  }

  return pickSetting("Setting");
};

const runSettingsShow = async (): Promise<void> => {
  const scope = await pickScope("Config show");
  const mode = await pickAllOrOne({ message: "Show", initial: "all" });
  const setting = await pickSettingForShow(mode);
  await showSettings({ scope, setting, format: "text" });
};

const runSettingsSet = async (abortSignal: AbortSignal): Promise<void> => {
  const scope = await pickScope("Config set");
  const setting = await pickSetting("Setting to change");
  const current = await readSettings(scope);
  const currentField = createSettingDisplay({ config: current.config, setting });
  const typedAnswer = await readPromptSettingField({ setting, current: currentField });
  const nextSettings = setSettingFromString({ config: current.config, setting, typedAnswer });
  const nextField = createSettingDisplay({ config: nextSettings, setting });

  await applyIfApproved({
    title: "Config set plan",
    steps: [
      { label: "Action", detail: "set managed setting" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: setting.name },
      { label: "From", detail: currentField },
      { label: "To", detail: nextField },
      { label: "Path", detail: current.configPath },
    ],
    confirmMessage: "Apply this config change?",
    apply: async () => {
      const owner = await saveSettings(
        { target: current, configuration: { _tag: "selected", config: nextSettings } },
        abortSignal,
      );
      await TerminalUI.runSuccess(`${setting.label} → ${nextField} (${owner})`);
    },
  });
};

const runSettingsResetAll = async (scope: Scope, abortSignal: AbortSignal): Promise<void> => {
  // A full reset never reads the old file, so it also repairs a config.json that no longer decodes.
  const target = await readLocateSettingsTarget(scope);
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
      await saveSettings({ target, configuration: { _tag: "reset" } }, abortSignal);
      await TerminalUI.runSuccess(`All ${scope} settings reset.`);
    },
  });
};

const runSettingsResetOne = async (scope: Scope, abortSignal: AbortSignal): Promise<void> => {
  const current = await readSettings(scope);
  const setting = await pickSetting("Setting to reset");
  const nextSettings = setSettingField({
    config: current.config,
    key: setting.key,
    value: readDefaultSettingField(setting.key),
  });
  const nextField = createSettingDisplay({ config: nextSettings, setting });

  await applyIfApproved({
    title: "Config reset plan",
    steps: [
      { label: "Action", detail: "reset one setting" },
      { label: "Scope", detail: scope },
      { label: "Setting", detail: setting.name },
      { label: "From", detail: createSettingDisplay({ config: current.config, setting }) },
      { label: "To", detail: nextField },
      { label: "Path", detail: current.configPath },
    ],
    confirmMessage: "Apply this config reset?",
    apply: async () => {
      await saveSettings({ target: current, configuration: { _tag: "selected", config: nextSettings } }, abortSignal);
      await TerminalUI.runSuccess(`${setting.name} reset to ${nextField}`);
    },
  });
};

const runSettingsReset = async (abortSignal: AbortSignal): Promise<void> => {
  const scope = await pickScope("Config reset");
  const resetMode = await pickAllOrOne({ message: "Reset", initial: "one" });

  const isResetAll = resetMode === "all";
  if (isResetAll) {
    await runSettingsResetAll(scope, abortSignal);
    return;
  }

  await runSettingsResetOne(scope, abortSignal);
};

export const runSettings = async (abortSignal: AbortSignal): Promise<void> => {
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
      await runSettingsShow();
      return;
    case "set":
      await runSettingsSet(abortSignal);
      return;
    case "reset":
      await runSettingsReset(abortSignal);
      return;
    case "back":
      return;
  }
};
