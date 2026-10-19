import { Effect, Option, Schema, SchemaAST, type ParseResult as SchemaParseIssue, Struct } from "effect";

import { durationSchema } from "./durationSchema.js";

const withDefault = <Value, Encoded>(schema: Schema.Schema<Value, Encoded>, fallback: Value) =>
  Schema.optionalWith(schema, { default: () => fallback, exact: true });

const numberSetting = (setting: {
  readonly range: readonly [number, number];
  readonly outOfRange: string;
  readonly fallback: number;
  readonly title: string;
  readonly description: string;
}) =>
  withDefault(
    Schema.Number.pipe(Schema.between(...setting.range, { message: () => setting.outOfRange })),
    setting.fallback,
  ).annotations({ title: setting.title, description: setting.description });

const trimmed = <Value, Encoded extends string>(schema: Schema.Schema<Value, Encoded>) =>
  Schema.Trim.pipe(Schema.compose(schema));

const CODE_ROOT_FOLDERS = ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"];

// Every setting carries its CLI label (title) and meaning (description) on its property signature,
// so the CLI, the menu, and the README settings table all read one declaration.
export const configSchema = Schema.Struct({
  contextWarnPercent: numberSetting({
    range: [1, 95],
    outOfRange: "Context warning percent must be between 1 and 95.",
    fallback: 18,
    title: "context warn (%)",
    description: "Context use, as a whole percent of the model window, that starts the handoff warning (18 means 18%).",
  }),
  contextBlockPercent: numberSetting({
    range: [1, 99],
    outOfRange: "Context block percent must be between 1 and 99.",
    fallback: 20,
    title: "context block (%)",
    description: "Context use, as a whole percent of the model window, that blocks new code edits.",
  }),
  autorunDefaultCycles: numberSetting({
    range: [1, 1000],
    outOfRange: "Default autorun cycles must be between 1 and 1000.",
    fallback: 10,
    title: "autorun default cycles",
    description: "Compact cycles /autorun allows when no count is given.",
  }),
  autorunMaxCycles: numberSetting({
    range: [1, 1000],
    outOfRange: "Maximum autorun cycles must be between 1 and 1000.",
    fallback: 50,
    title: "autorun max cycles",
    description: "Hard limit on compact cycles for one autorun, whatever count is given.",
  }),
  autorunCheckEverySeconds: numberSetting({
    range: [1, 600],
    outOfRange: "Autorun check interval must be between 1 and 600 seconds.",
    fallback: 5,
    title: "autorun check every (seconds)",
    description: "Seconds between the autorun watcher's checks.",
  }),
  autorunIdleAfterSeconds: numberSetting({
    range: [1, 600],
    outOfRange: "Autorun idle time must be between 1 and 600 seconds.",
    fallback: 8,
    title: "autorun idle after (seconds)",
    description: "Seconds without transcript activity before autorun treats the turn as idle.",
  }),
  idleCompactAfter: withDefault(durationSchema, "off").annotations({
    title: "idle compact after",
    description:
      "How long an agent session sits idle before agent-setup submits a waiting draft or runs /compact: off, or a time like 30s, 2m, 1h.",
  }),
  duplicateCodeMode: withDefault(trimmed(Schema.Literal("block", "warn", "off")), "block").annotations({
    title: "duplicate code mode",
    description:
      "What the duplicate-code guard does with a copied function or type shape: block the edit, warn, or off.",
  }),
  duplicateCodeSkipFolders: withDefault(Schema.Array(Schema.NonEmptyTrimmedString), []).annotations({
    title: "duplicate code skip folders",
    description: "Folder names the duplicate-code guard skips, on top of its built-in skips such as node_modules.",
  }),
  sessionRehomeRoots: withDefault(Schema.Array(Schema.NonEmptyTrimmedString), CODE_ROOT_FOLDERS).annotations({
    title: "session rehome roots",
    description:
      "Folders (home-relative or absolute) whose git repos session-rehome may move Claude Code and Codex sessions into. Repos are found one and two levels deep.",
  }),
  diskCleanupRoots: withDefault(Schema.Array(Schema.NonEmptyTrimmedString), CODE_ROOT_FOLDERS).annotations({
    title: "disk cleanup roots",
    description:
      "Folders (home-relative or absolute) whose git repos disk-cleanup checks for finished worktrees to push and remove, and for unpushed branches to push. Repos are found one and two levels deep.",
  }),
  debugLogs: withDefault(Schema.Boolean, false).annotations({
    title: "debug logs",
    description: "Print agent-setup hook errors to stderr.",
  }),
}).pipe(
  Schema.filter((config) => [
    config.contextWarnPercent < config.contextBlockPercent
      ? undefined
      : {
          path: ["contextWarnPercent"],
          message: "Context warning percent must be below contextBlockPercent.",
        },
    config.autorunDefaultCycles <= config.autorunMaxCycles
      ? undefined
      : {
          path: ["autorunDefaultCycles"],
          message: "Default autorun cycles must not exceed autorunMaxCycles.",
        },
  ]),
);

export type Config = Schema.Schema.Type<typeof configSchema>;

type ConfigKey = keyof Config;

export const configJsonSchema = Schema.parseJson(configSchema);

export const defaultConfig = Schema.decodeUnknownSync(configSchema, { onExcessProperty: "error" })({});

const decodeConfig = Schema.decodeUnknown(configSchema, { onExcessProperty: "error" });

type ConfigProperty = Schema.PropertySignature.All;

// The value side (before the default) carries the kind; the property signature carries title and description.
const propertyParts = (property: ConfigProperty): { valueAst: SchemaAST.AST; annotations: SchemaAST.Annotated } => {
  switch (property.ast._tag) {
    case "PropertySignatureDeclaration":
      return { valueAst: property.ast.type, annotations: property.ast };
    case "PropertySignatureTransformation":
      return { valueAst: property.ast.from.type, annotations: property.ast.to };
  }
};

type SettingKind = "number" | "boolean" | "list" | "text";

const settingKind = (valueAst: SchemaAST.AST): SettingKind => {
  switch (SchemaAST.encodedAST(valueAst)._tag) {
    case "NumberKeyword":
      return "number";
    case "BooleanKeyword":
      return "boolean";
    case "TupleType":
      return "list";
    default:
      return "text";
  }
};

const literalChoices = (valueAst: SchemaAST.AST): ReadonlyArray<string> => {
  const typeAst = SchemaAST.typeAST(valueAst);
  if (SchemaAST.isBooleanKeyword(typeAst)) {
    return ["true", "false"];
  }

  const members = SchemaAST.isUnion(typeAst) ? typeAst.types : [typeAst];
  return members.flatMap((member) => (SchemaAST.isLiteral(member) ? [String(member.literal)] : []));
};

// e.g. "duplicateCodeSkipFolders" → "duplicate-code-skip-folders"
const settingNameFor = (key: ConfigKey): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

type ConfigSetting = {
  readonly key: ConfigKey;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly kind: SettingKind;
  readonly choices: ReadonlyArray<string>;
  readonly optional: boolean;
};

const configFields = configSchema.from.fields;

export const configSettings: ReadonlyArray<ConfigSetting> = Struct.keys(configFields).map((key) => {
  const property: ConfigProperty = configFields[key];
  const { valueAst, annotations } = propertyParts(property);
  return {
    key,
    name: settingNameFor(key),
    label: Option.getOrElse(SchemaAST.getTitleAnnotation(annotations), () => key),
    description: Option.getOrElse(SchemaAST.getDescriptionAnnotation(annotations), () => ""),
    kind: settingKind(valueAst),
    choices: literalChoices(valueAst),
    optional: property.ast._tag === "PropertySignatureDeclaration" && property.ast.isOptional,
  };
});

const decodeNumberText = Schema.decodeUnknown(Schema.NumberFromString);

const decodeBooleanText = Schema.decodeUnknown(Schema.BooleanFromString);

// Turn CLI text into the value a setting stores; empty text clears an optional setting.
export const settingValueFromText = (request: {
  readonly setting: ConfigSetting;
  readonly text: string;
}): Effect.Effect<Option.Option<unknown>, SchemaParseIssue.ParseError> => {
  if (request.setting.optional && request.text.trim() === "") {
    return Effect.succeed(Option.none());
  }

  switch (request.setting.kind) {
    case "number":
      return decodeNumberText(request.text.trim()).pipe(Effect.map(Option.some));
    case "boolean":
      return decodeBooleanText(request.text.trim()).pipe(Effect.map(Option.some));
    case "list":
      return Effect.succeed(
        Option.some(
          request.text
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
        ),
      );
    case "text":
      return Effect.succeed(Option.some(request.text));
  }
};

export const defaultSettingValue = (key: ConfigKey): Option.Option<unknown> =>
  key in defaultConfig ? Option.some(defaultConfig[key]) : Option.none();

// A cleared optional setting leaves config.json without the key instead of storing an empty value.
export const withSettingValue = (request: {
  readonly config: Config;
  readonly key: ConfigKey;
  readonly value: Option.Option<unknown>;
}) =>
  decodeConfig(
    Option.match(request.value, {
      onNone: () => Struct.omit(request.config, request.key),
      onSome: (value) => ({ ...request.config, [request.key]: value }),
    }),
  );
