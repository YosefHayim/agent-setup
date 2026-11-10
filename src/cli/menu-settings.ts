/** Menu screens that change managed config values. */

import { Effect } from "effect";

import {
  configSettings,
  defaultSettingValue,
  settingValueFromText,
  withSettingValue,
} from "../config/config-schema.js";
import { locateConfigTarget, readConfig, saveConfig } from "../config/scope-config.js";
import type { Scope } from "../install/receipt.js";
import { createCliUsageError } from "./cli-options.js";
import { formatSettingValue, showConfig } from "./config-command.js";
import * as TerminalUI from "./terminal-ui.js";

type ConfigSetting = (typeof configSettings)[number];

export const pickScope = (verb: string) =>
  Effect.tryPromise({
    try: () =>
      TerminalUI.selectOne<Scope>({
        message: `${verb} — which scope?`,
        choices: [
          { title: "global", value: "global", description: "home root · every session" },
          { title: "project", value: "project", description: "this repo · committable" },
        ],
        initial: "global",
      }),
    catch: (error) => error,
  });

/** Show the plan and run `apply` only once the user approves it. */
export const applyIfApproved = <E, R>(request: {
  readonly title: string;
  readonly steps: ReadonlyArray<{ readonly label: string; readonly detail: string }>;
  readonly confirmMessage: string;
  readonly apply: Effect.Effect<void, E, R>;
}) =>
  Effect.if(Effect.tryPromise({ try: () => TerminalUI.confirmPlan(request), catch: (error) => error }), {
    onTrue: () => request.apply,
    onFalse: () => Effect.tryPromise({ try: () => TerminalUI.showCancelledOutro(), catch: (error) => error }),
  });

// Literal settings offer their schema values; an optional setting also offers "" to clear it.
const settingChoices = (setting: ConfigSetting): ReadonlyArray<string> =>
  setting.optional && setting.choices.length > 0 ? [...setting.choices, ""] : setting.choices;

const pickSetting = (message: string) =>
  Effect.tryPromise({
    try: () =>
      TerminalUI.selectOne<ConfigSetting>({
        message,
        choices: configSettings.map((setting) => ({ title: setting.name, value: setting, description: setting.label })),
        initial: configSettings[0],
      }),
    catch: (error) => error,
  });

const promptSettingValue = (request: { readonly setting: ConfigSetting; readonly current: string }) => {
  const { setting, current } = request;
  const choices = settingChoices(setting);
  if (choices.length === 0) {
    const numberHint = setting.kind === "number" ? " (number)" : "";
    return Effect.tryPromise({
      try: () => TerminalUI.optionalText({ message: `Value for ${setting.name}${numberHint}`, fallback: current }),
      catch: (error) => error,
    });
  }

  return Effect.tryPromise({
    try: () =>
      TerminalUI.selectOne({
        message: `Value for ${setting.name}`,
        choices: choices.map((value) => ({
          title: value === "" ? "(not set)" : value,
          value,
          description: value === current ? "current" : undefined,
        })),
        initial: choices.includes(current) ? current : choices[0],
      }),
    catch: (error) => error,
  });
};

const pickAllOrOne = (request: { readonly message: string; readonly initial: "all" | "one" }) =>
  Effect.tryPromise({
    try: () =>
      TerminalUI.selectOne<"all" | "one">({
        message: request.message,
        choices: [
          { title: "All settings", value: "all" },
          { title: "One setting", value: "one" },
        ],
        initial: request.initial,
      }),
    catch: (error) => error,
  });

const runConfigShow = Effect.gen(function* () {
  const scope = yield* pickScope("Config show");
  const mode = yield* pickAllOrOne({ message: "Show", initial: "all" });
  const setting = yield* mode === "one" ? Effect.asSome(pickSetting("Setting")) : Effect.succeedNone;
  yield* showConfig({ scope, setting, format: "text" });
});

const runConfigSet = Effect.gen(function* () {
  const scope = yield* pickScope("Config set");
  const setting = yield* pickSetting("Setting to change");
  const current = yield* Effect.tryPromise({ try: () => readConfig(scope), catch: (error) => error });
  const currentValue = formatSettingValue({ config: current.config, setting });
  const text = yield* promptSettingValue({ setting, current: currentValue });
  const nextConfig = yield* Effect.try({
    try: () => {
      const value = settingValueFromText({ setting, text });
      return withSettingValue({ config: current.config, key: setting.key, value });
    },
    catch: (error) => createCliUsageError(String(error)),
  });
  const nextValue = formatSettingValue({ config: nextConfig, setting });
  yield* applyIfApproved({
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
    apply: Effect.tryPromise({
      try: (signal) => saveConfig({ target: current, configuration: { _tag: "selected", config: nextConfig } }, signal),
      catch: (error) => error,
    }).pipe(
      Effect.flatMap((owner) =>
        Effect.tryPromise({
          try: () => TerminalUI.success(`${setting.label} → ${nextValue} (${owner})`),
          catch: (error) => error,
        }),
      ),
    ),
  });
});

const runConfigReset = Effect.gen(function* () {
  const scope = yield* pickScope("Config reset");
  if ((yield* pickAllOrOne({ message: "Reset", initial: "one" })) === "all") {
    // A full reset never reads the old file, so it also repairs a config.json that no longer decodes.
    const target = yield* Effect.tryPromise({ try: () => locateConfigTarget(scope), catch: (error) => error });
    yield* applyIfApproved({
      title: "Config reset plan",
      steps: [
        { label: "Action", detail: "reset all settings" },
        { label: "Scope", detail: scope },
        { label: "Setting", detail: "every setting" },
        { label: "To", detail: "Schema defaults" },
        { label: "Path", detail: target.configPath },
      ],
      confirmMessage: "Apply this config reset?",
      apply: Effect.tryPromise({
        try: (signal) => saveConfig({ target, configuration: { _tag: "reset" } }, signal),
        catch: (error) => error,
      }).pipe(
        Effect.zipRight(
          Effect.tryPromise({ try: () => TerminalUI.success(`All ${scope} settings reset.`), catch: (error) => error }),
        ),
      ),
    });
    return;
  }

  const current = yield* Effect.tryPromise({ try: () => readConfig(scope), catch: (error) => error });
  const setting = yield* pickSetting("Setting to reset");
  const nextConfig = yield* Effect.try({
    try: () => withSettingValue({ config: current.config, key: setting.key, value: defaultSettingValue(setting.key) }),
    catch: (error) => createCliUsageError(String(error)),
  });
  const nextValue = formatSettingValue({ config: nextConfig, setting });
  yield* applyIfApproved({
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
    apply: Effect.tryPromise({
      try: (signal) => saveConfig({ target: current, configuration: { _tag: "selected", config: nextConfig } }, signal),
      catch: (error) => error,
    }).pipe(
      Effect.zipRight(
        Effect.tryPromise({
          try: () => TerminalUI.success(`${setting.name} reset to ${nextValue}`),
          catch: (error) => error,
        }),
      ),
    ),
  });
});

export const runConfig = Effect.gen(function* () {
  const action = yield* Effect.tryPromise({
    try: () =>
      TerminalUI.selectOne<"show" | "set" | "reset" | "back">({
        message: "Config",
        choices: [
          { title: "Show", value: "show", description: "inspect managed settings" },
          { title: "Set", value: "set", description: "change one setting" },
          { title: "Reset", value: "reset", description: "restore Schema defaults" },
          { title: "Back", value: "back" },
        ],
        initial: "show",
      }),
    catch: (error) => error,
  });
  switch (action) {
    case "show":
      return yield* runConfigShow;
    case "set":
      return yield* runConfigSet;
    case "reset":
      return yield* runConfigReset;
    case "back":
      return;
  }
});
