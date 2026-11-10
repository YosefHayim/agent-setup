/** `agent-setup config show|set|reset` — managed configuration as explicit verbs. */

import { Args, Command } from "@effect/cli";
import { Effect, Option } from "effect";
import { ZodError } from "zod";

import {
  type Config,
  configSettings,
  defaultConfig,
  defaultSettingValue,
  settingValueFromText,
  withSettingValue,
} from "../config/config-schema.js";
import { readConfig, resolveConfigTarget, saveConfig } from "../config/scope-config.js";
import type { Scope } from "../install/receipt.js";
import { joinZodIssueMessages } from "../zod-issue-messages.js";
import {
  CliUsageError,
  confirmDestructive,
  formatOption,
  type OutputFormat,
  scopeOption,
  yesOption,
} from "./cli-options.js";
import * as TerminalUI from "./terminal-ui.js";

// A rejected setting value is bad usage (exit 2), shown as zod's own messages.
const describeSettingRejection = (error: unknown): string => {
  const isZodRejection = error instanceof ZodError;
  if (isZodRejection) {
    return joinZodIssueMessages(error);
  }

  return String(error);
};

type ConfigSetting = (typeof configSettings)[number];

const settingArgument = Args.choice(
  configSettings.map((setting): [string, ConfigSetting] => [setting.name, setting]),
  { name: "setting" },
).pipe(Args.withDescription("Managed setting name"));

export const formatSettingValue = (request: { readonly config: Config; readonly setting: ConfigSetting }): string => {
  const value: unknown = request.config[request.setting.key];
  if (value === undefined) {
    return "(not set)";
  }

  return Array.isArray(value) ? value.join(", ") : String(value);
};

export const showConfig = (request: {
  readonly scope: Scope;
  readonly setting: Option.Option<ConfigSetting>;
  readonly format: OutputFormat;
}) =>
  Effect.gen(function* () {
    const { config } = yield* readConfig(request.scope);
    if (Option.isSome(request.setting)) {
      const setting = request.setting.value;
      if (request.format === "json") {
        yield* TerminalUI.json({ scope: request.scope, setting: setting.name, value: config[setting.key] });
      } else {
        yield* TerminalUI.note(`${setting.label}  ${formatSettingValue({ config, setting })}`, "managed config");
      }
      return;
    }

    if (request.format === "json") {
      yield* TerminalUI.json({ scope: request.scope, config });
      return;
    }
    const lines = configSettings.map(
      (setting) => `${setting.label.padEnd(40)} ${formatSettingValue({ config, setting })}`,
    );
    yield* TerminalUI.note(lines.join("\n"), "managed config");
  });

const showCommand = Command.make(
  "show",
  { setting: settingArgument.pipe(Args.optional), scope: scopeOption, format: formatOption },
  showConfig,
).pipe(Command.withDescription("Show all settings or one named setting"));

const setCommand = Command.make(
  "set",
  {
    setting: settingArgument,
    value: Args.text({ name: "value" }).pipe(Args.withDescription("New setting value")),
    scope: scopeOption,
    format: formatOption,
  },
  (args) =>
    Effect.gen(function* () {
      const { setting } = args;
      const current = yield* readConfig(args.scope);
      const value = yield* Effect.try({
        try: () => settingValueFromText({ setting, text: args.value }),
        catch: (error) => new CliUsageError({ issue: describeSettingRejection(error) }),
      });
      const nextConfig = yield* Effect.try({
        try: () => withSettingValue({ config: current.config, key: setting.key, value }),
        catch: (error) => new CliUsageError({ issue: describeSettingRejection(error) }),
      });
      const owner = yield* saveConfig({ target: current, configuration: { _tag: "selected", config: nextConfig } });
      if (args.format === "text") {
        yield* TerminalUI.success(`${setting.label} → ${formatSettingValue({ config: nextConfig, setting })}`);
        return;
      }
      yield* TerminalUI.json({
        _tag: "configured",
        scope: args.scope,
        setting: setting.name,
        value: nextConfig[setting.key],
        owner,
      });
    }),
).pipe(Command.withDescription("Set one managed setting"));

const resetCommand = Command.make(
  "reset",
  { setting: settingArgument.pipe(Args.optional), scope: scopeOption, yes: yesOption, format: formatOption },
  (args) =>
    Effect.gen(function* () {
      if (Option.isNone(args.setting)) {
        const confirmed = yield* confirmDestructive({
          yes: args.yes,
          question: `Reset every ${args.scope} setting to its Schema default?`,
          missingYesIssue: "Non-interactive full config reset requires --yes.",
        });
        if (!confirmed) {
          yield* TerminalUI.showCancelled(args);
          return;
        }

        const target = yield* resolveConfigTarget(args.scope);
        const owner = yield* saveConfig({ target, configuration: { _tag: "reset" } });
        if (args.format === "json") {
          yield* TerminalUI.json({ _tag: "reset", scope: args.scope, config: defaultConfig, owner });
        } else {
          yield* TerminalUI.success(`All ${args.scope} settings reset to Schema defaults.`);
        }
        return;
      }

      const setting = args.setting.value;
      const current = yield* readConfig(args.scope);
      const nextConfig = yield* Effect.try({
        try: () =>
          withSettingValue({ config: current.config, key: setting.key, value: defaultSettingValue(setting.key) }),
        catch: (error) => error,
      });
      const owner = yield* saveConfig({ target: current, configuration: { _tag: "selected", config: nextConfig } });
      if (args.format === "json") {
        yield* TerminalUI.json({ _tag: "reset", scope: args.scope, setting: setting.name, config: nextConfig, owner });
      } else {
        yield* TerminalUI.success(`${setting.label} reset to ${formatSettingValue({ config: nextConfig, setting })}`);
      }
    }),
).pipe(Command.withDescription("Reset one setting or every setting to Schema defaults"));

export const configCommand = Command.make("config").pipe(
  Command.withDescription("Inspect or change managed configuration"),
  Command.withSubcommands([showCommand, setCommand, resetCommand]),
);
