import { Effect, Option, Schema, SchemaAST, type ParseResult as SchemaParseIssue, Struct } from "effect";

const withDefault = <Value, Encoded>(schema: Schema.Schema<Value, Encoded>, fallback: Value) =>
  Schema.optionalWith(schema, { default: () => fallback, exact: true });

const CODE_ROOT_FOLDERS = ["Desktop/Code", "Code", "Projects", "dev", "src", "repos"];

// Every setting carries its CLI label (title) and meaning (description) on its property signature,
// so the CLI, the menu, and the README settings table all read one declaration.
export const configSchema = Schema.Struct({
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
});

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

// e.g. "debugLogs" → "debug-logs"
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

const configFields = configSchema.fields;

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
