import { z } from "zod";

import { nonEmptyTrimmedTextSchema } from "#src/install/text-rules.js";

const CODE_ROOT_FOLDERS = ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"];

const rootFolderListSchema = z.array(nonEmptyTrimmedTextSchema).default(CODE_ROOT_FOLDERS);

const settingsObjectSchema = z.strictObject({
  sessionRehomeRoots: rootFolderListSchema,
  diskCleanupRoots: rootFolderListSchema,
  debugLogs: z.boolean().default(false),
});

export type Config = z.infer<typeof settingsObjectSchema>;

type SettingKey = keyof Config;

// A key set to undefined is rejected here, before defaults fill it in; JSON files can never carry one.
const rejectUndefinedProperties = (details: unknown, refinement: z.RefinementCtx) => {
  const isNotPlainObject = typeof details !== "object" || details === null;
  if (isNotPlainObject) {
    return;
  }

  for (const [key, field] of Object.entries(details)) {
    const isUndefinedField = typeof field === "undefined";
    if (isUndefinedField) {
      refinement.addIssue({ code: "custom", message: "Properties must not be undefined.", path: [key] });
    }
  }
};

export const settingsSchema = z.unknown().superRefine(rejectUndefinedProperties).pipe(settingsObjectSchema);

// Temporary bridge for the Effect schemas that still validate configs; removed with those schemas.
export const isConfig = (details: unknown): details is Config => settingsSchema.safeParse(details).success;

export const encodeSettingsDocument = (settings: Config): string => JSON.stringify(settings);

export const defaultConfig: Config = settingsObjectSchema.parse({});

type SettingKind = "number" | "boolean" | "list" | "text";

export interface Setting {
  readonly key: SettingKey;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly kind: SettingKind;
  readonly choices: ReadonlyArray<string>;
  readonly optional: boolean;
}

interface SettingDefinition {
  readonly key: SettingKey;
  readonly label: string;
  readonly description: string;
  readonly kind: SettingKind;
}

// The CLI label and meaning of every setting; the CLI, the menu and the README settings table all read this one list.
const settingDefinitions = [
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
] as const satisfies ReadonlyArray<SettingDefinition>;

// e.g. "debugLogs" → "debug-logs"
const readSettingName = (key: SettingKey): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const listKindChoices = (kind: SettingKind): ReadonlyArray<string> => {
  const isBooleanKind = kind === "boolean";

  if (isBooleanKind) {
    return ["true", "false"];
  }

  return [];
};

export const settingList: ReadonlyArray<Setting> = settingDefinitions.map((definition) => ({
  key: definition.key,
  name: readSettingName(definition.key),
  label: definition.label,
  description: definition.description,
  kind: definition.kind,
  choices: listKindChoices(definition.kind),
  optional: false,
}));

const booleanStringSchema = z.enum(["true", "false"]).transform((string) => string === "true");

const numberStringSchema = z
  .string()
  .refine((string) => string !== "" && Number.isFinite(Number(string)), { message: "Expected a number." })
  .transform((string) => Number(string));

const listStringSchema = z
  .string()
  .transform((string) => string.split(",").map((line) => line.trim()))
  .transform((lines) => lines.filter((line) => line !== ""));

// Turns CLI text into the value a setting stores; empty text clears an optional setting (null).
// A text the setting cannot hold throws a ZodError.
export const readSettingFieldFromString = (request: { readonly setting: Setting; readonly text: string }): unknown => {
  const trimmedString = request.text.trim();

  const isClearingOptionalSetting = request.setting.optional && trimmedString === "";
  if (isClearingOptionalSetting) {
    return null;
  }

  switch (request.setting.kind) {
    case "number":
      return numberStringSchema.parse(trimmedString);
    case "boolean":
      return booleanStringSchema.parse(trimmedString);
    case "list":
      return listStringSchema.parse(request.text);
    case "text":
      return request.text;
  }
};

export const readDefaultSettingField = (key: SettingKey): unknown => defaultConfig[key];

// Returns a new complete config with one setting replaced; a null value removes an optional setting's key.
// An invalid value throws a ZodError.
export const setSettingField = (request: {
  readonly config: Config;
  readonly key: SettingKey;
  readonly value: unknown;
}) => {
  const isClearingSetting = request.value === null;
  if (isClearingSetting) {
    const remainingLines = Object.entries(request.config).filter(([name]) => name !== request.key);
    return settingsSchema.parse(Object.fromEntries(remainingLines));
  }

  return settingsSchema.parse({ ...request.config, [request.key]: request.value });
};
