import { z } from "zod";

import { nonEmptyTrimmedTextSchema } from "../install/text-rules.js";

const CODE_ROOT_FOLDERS = ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"];

const rootFolderListSchema = z.array(nonEmptyTrimmedTextSchema).default(CODE_ROOT_FOLDERS);

const configObjectSchema = z.strictObject({
  sessionRehomeRoots: rootFolderListSchema,
  diskCleanupRoots: rootFolderListSchema,
  debugLogs: z.boolean().default(false),
});

export type Config = z.infer<typeof configObjectSchema>;

type ConfigKey = keyof Config;

// A key set to undefined is rejected here, before defaults fill it in; JSON files can never carry one.
const rejectUndefinedProperties = (input: unknown, context: z.RefinementCtx) => {
  if (typeof input !== "object" || input === null) {
    return;
  }

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      context.addIssue({ code: "custom", message: "Properties must not be undefined.", path: [key] });
    }
  }
};

export const configSchema = z.unknown().superRefine(rejectUndefinedProperties).pipe(configObjectSchema);

// Temporary bridge for the Effect schemas that still validate configs; removed with those schemas.
export const isConfig = (input: unknown): input is Config => configSchema.safeParse(input).success;

export const encodeConfigJson = (config: Config): string => JSON.stringify(config);

export const defaultConfig: Config = configObjectSchema.parse({});

export type SettingKind = "number" | "boolean" | "list" | "text";

export interface ConfigSetting {
  readonly key: ConfigKey;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly kind: SettingKind;
  readonly choices: ReadonlyArray<string>;
  readonly optional: boolean;
}

interface ConfigSettingDefinition {
  readonly key: ConfigKey;
  readonly label: string;
  readonly description: string;
  readonly kind: SettingKind;
}

// The CLI label and meaning of every setting; the CLI, the menu and the README settings table all read this one list.
const configSettingDefinitions = [
  {
    key: "sessionRehomeRoots",
    label: "session rehome roots",
    description:
      "Folders (home-relative or absolute) whose git repos session-rehome may move Claude Code and Codex sessions into. Repos are found one and two levels deep.",
    kind: "list",
  },
  {
    key: "diskCleanupRoots",
    label: "disk cleanup roots",
    description:
      "Folders (home-relative or absolute) whose git repos disk-cleanup checks for finished worktrees to push and remove, and for unpushed branches to push. Repos are found one and two levels deep.",
    kind: "list",
  },
  {
    key: "debugLogs",
    label: "debug logs",
    description: "Print agent-setup hook errors to stderr.",
    kind: "boolean",
  },
] as const satisfies ReadonlyArray<ConfigSettingDefinition>;

// e.g. "debugLogs" → "debug-logs"
const settingNameFor = (key: ConfigKey): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const choicesFor = (kind: SettingKind): ReadonlyArray<string> => (kind === "boolean" ? ["true", "false"] : []);

export const configSettings: ReadonlyArray<ConfigSetting> = configSettingDefinitions.map((definition) => ({
  key: definition.key,
  name: settingNameFor(definition.key),
  label: definition.label,
  description: definition.description,
  kind: definition.kind,
  choices: choicesFor(definition.kind),
  optional: false,
}));

const booleanTextSchema = z.enum(["true", "false"]).transform((text) => text === "true");

const numberTextSchema = z
  .string()
  .refine((text) => text !== "" && Number.isFinite(Number(text)), { message: "Expected a number." })
  .transform((text) => Number(text));

const listTextSchema = z
  .string()
  .transform((text) => text.split(",").map((entry) => entry.trim()))
  .transform((entries) => entries.filter((entry) => entry !== ""));

// Turns CLI text into the value a setting stores; empty text clears an optional setting (null).
// A text the setting cannot hold throws a ZodError.
export const settingValueFromText = (request: { readonly setting: ConfigSetting; readonly text: string }): unknown => {
  const trimmedText = request.text.trim();
  const isClearingOptionalSetting = request.setting.optional && trimmedText === "";
  if (isClearingOptionalSetting) {
    return null;
  }

  switch (request.setting.kind) {
    case "number":
      return numberTextSchema.parse(trimmedText);
    case "boolean":
      return booleanTextSchema.parse(trimmedText);
    case "list":
      return listTextSchema.parse(request.text);
    case "text":
      return request.text;
  }
};

export const defaultSettingValue = (key: ConfigKey): unknown => defaultConfig[key];

// Returns a new complete config with one setting replaced; a null value removes an optional setting's key.
// An invalid value throws a ZodError.
export const withSettingValue = (request: {
  readonly config: Config;
  readonly key: ConfigKey;
  readonly value: unknown;
}) => {
  const isClearingSetting = request.value === null;
  if (isClearingSetting) {
    const remainingEntries = Object.entries(request.config).filter(([name]) => name !== request.key);
    return configSchema.parse(Object.fromEntries(remainingEntries));
  }

  return configSchema.parse({ ...request.config, [request.key]: request.value });
};
