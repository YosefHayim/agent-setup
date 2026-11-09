/** Continue's JSON config: add or remove one instruction path in its top-level `rules` array, keeping the user's other bytes. */

import { Either, Schema, ParseResult as SchemaParseIssue } from "effect";
import { applyEdits, type Node as JsonNode, modify, parseTree } from "jsonc-parser";

import { decodeStrictText, lineEnding } from "../file-bytes.js";
import { findDuplicateJsonKey } from "../find-duplicate-json-key.js";
import { hashJsonValue, jsonPropertyName } from "../json-edit.js";
import type { InstalledJsonValue, JsonValuesOwnership, PreviousJsonValue } from "../ownership.js";

const textEncoder = new TextEncoder();
const encodeJson = Schema.encodeSync(Schema.parseJson());
const instructionReferencesSchema = Schema.Array(Schema.String);
const isInstructionReferences = Schema.is(instructionReferencesSchema);

type JsonRulesLink = {
  readonly currentBytes: Uint8Array | undefined;
  readonly configPath: string;
  readonly instructionPath: string;
  readonly previousOwnership: JsonValuesOwnership | undefined;
};

type JsonConfiguration = { readonly source: string; readonly rules: ReadonlyArray<string> | undefined };

const jsonConfigurationSchema = Schema.Struct(
  {
    rules: Schema.optional(instructionReferencesSchema).annotations({
      description: "Native Continue instruction-file references.",
    }),
  },
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

const ownedRules = (ownership: JsonValuesOwnership) => ownership.values.find((value) => value.pointer === "/rules");

const installedJsonValueMatches = (installed: InstalledJsonValue, value: unknown): boolean =>
  value !== undefined && hashJsonValue(value) === installed.hash;

export const jsonRulesOwnershipIsValid = (ownership: JsonValuesOwnership): boolean => {
  const owned = ownership.values[0];

  return (
    ownership.values.length === 1 &&
    ownership.createdContainers.length === 0 &&
    owned?.pointer === "/rules" &&
    owned.installed._tag === "value" &&
    (owned.previous._tag === "missing" || isInstructionReferences(owned.previous.value))
  );
};

const parseJsonObjectNode = (source: string): Either.Either<JsonNode, string> => {
  const root = parseTree(source, [], { allowTrailingComma: false, disallowComments: true });

  return root?.type === "object" ? Either.right(root) : Either.left("Continue configuration must be one JSON object.");
};

const insertMissingJsonRules = (source: string, rules: ReadonlyArray<string>): Either.Either<string, string> =>
  Either.map(parseJsonObjectNode(source), (root) => {
    const lastProperty = root.children?.at(-1);
    const insertionIndex = lastProperty === undefined ? root.offset + 1 : lastProperty.offset + lastProperty.length;
    const separator = lastProperty === undefined ? "" : ",";

    return `${source.slice(0, insertionIndex)}${separator}"rules":${encodeJson(rules)}${source.slice(insertionIndex)}`;
  });

// Removes the member together with the comma that joined it to a neighbour, so the rest stays byte-identical.
const removeInsertedJsonRules = (source: string): Either.Either<string, string> => {
  const root = parseJsonObjectNode(source);
  if (Either.isLeft(root)) {
    return Either.left(root.left);
  }

  const properties = root.right.children || [];
  const rulesIndex = properties.findIndex((property) => jsonPropertyName(property) === "rules");
  const rulesProperty = properties[rulesIndex];
  if (rulesIndex < 0 || rulesProperty === undefined) {
    return Either.left("Receipted Continue rules member is missing.");
  }

  const rulesEnd = rulesProperty.offset + rulesProperty.length;
  if (properties.length === 1) {
    return Either.right(`${source.slice(0, rulesProperty.offset)}${source.slice(rulesEnd)}`);
  }

  if (rulesIndex > 0) {
    const previousProperty = properties[rulesIndex - 1];
    if (previousProperty === undefined) {
      return Either.left("Continue rules member has no stable preceding property.");
    }

    const previousEnd = previousProperty.offset + previousProperty.length;
    const commaOffset = source.slice(previousEnd, rulesProperty.offset).lastIndexOf(",");
    if (commaOffset < 0) {
      return Either.left("Continue rules member has no stable preceding comma.");
    }

    return Either.right(`${source.slice(0, previousEnd + commaOffset)}${source.slice(rulesEnd)}`);
  }

  const nextProperty = properties[1];
  if (nextProperty === undefined) {
    return Either.left("Continue rules member has no stable following property.");
  }

  const commaOffset = source.slice(rulesEnd, nextProperty.offset).indexOf(",");
  if (commaOffset < 0) {
    return Either.left("Continue rules member has no stable following comma.");
  }

  return Either.right(`${source.slice(0, rulesProperty.offset)}${source.slice(rulesEnd + commaOffset + 1)}`);
};

const replaceRules = (source: string, rules: ReadonlyArray<string>): string =>
  applyEdits(
    source,
    modify(source, ["rules"], rules, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: lineEnding(source) },
    }),
  );

const decodeJsonConfiguration = (bytes: Uint8Array, filename: string): Either.Either<JsonConfiguration, string> =>
  Either.flatMap(decodeStrictText(bytes, filename), (source) => {
    const duplicateProperty = findDuplicateJsonKey(source);
    if (duplicateProperty !== undefined) {
      return Either.left(`${filename} contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`);
    }

    return Either.mapBoth(
      Schema.decodeUnknownEither(Schema.parseJson(jsonConfigurationSchema), { onExcessProperty: "preserve" })(source),
      {
        onLeft: (error) => `${filename} is invalid: ${SchemaParseIssue.TreeFormatter.formatErrorSync(error)}`,
        onRight: (configuration) => ({ source, rules: configuration.rules }),
      },
    );
  });

const createJsonOwnership = (input: {
  link: JsonRulesLink;
  previousRules: ReadonlyArray<string> | undefined;
  desiredRules: ReadonlyArray<string>;
}): JsonValuesOwnership => {
  const previousOwnership = input.link.previousOwnership;
  const history = previousOwnership === undefined ? undefined : ownedRules(previousOwnership);
  const previous: PreviousJsonValue =
    input.previousRules === undefined ? { _tag: "missing" } : { _tag: "value", value: input.previousRules };

  return {
    _tag: "jsonValues",
    filePreviouslyPresent:
      previousOwnership === undefined ? input.link.currentBytes !== undefined : previousOwnership.filePreviouslyPresent,
    createdContainers: [],
    values: [
      {
        pointer: "/rules",
        installed: { _tag: "value", hash: hashJsonValue(input.desiredRules) },
        previous: history === undefined ? previous : history.previous,
      },
    ],
  };
};

export const addJsonRule = (
  link: JsonRulesLink,
): Either.Either<{ bytes: Uint8Array; ownership: JsonValuesOwnership }, string> => {
  const current =
    link.currentBytes === undefined
      ? Either.right({ source: "{}\n", rules: undefined })
      : decodeJsonConfiguration(link.currentBytes, link.configPath);
  if (Either.isLeft(current)) {
    return Either.left(current.left);
  }

  const { source, rules: previousRules } = current.right;
  const owned = link.previousOwnership === undefined ? undefined : ownedRules(link.previousOwnership);
  if (
    link.previousOwnership !== undefined &&
    (owned === undefined || !installedJsonValueMatches(owned.installed, previousRules))
  ) {
    return Either.left("Receipted Continue rules changed after installation.");
  }

  if (previousRules?.includes(link.instructionPath)) {
    return Either.right({
      bytes: textEncoder.encode(source),
      ownership: createJsonOwnership({ link, previousRules, desiredRules: previousRules }),
    });
  }

  const desiredRules = [...(previousRules || []), link.instructionPath];
  const desiredSource =
    previousRules === undefined
      ? insertMissingJsonRules(source, desiredRules)
      : Either.right(replaceRules(source, desiredRules));

  return Either.map(desiredSource, (edited) => ({
    bytes: textEncoder.encode(edited),
    ownership: createJsonOwnership({ link, previousRules, desiredRules }),
  }));
};

const jsonObjectIsEmpty = (source: string): boolean => {
  const decoded = Schema.decodeUnknownEither(
    Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  )(source);

  return Either.isRight(decoded) && Object.keys(decoded.right).length === 0;
};

// Empty bytes mean the file held nothing but what the installation added, so the caller may delete it.
export const removeJsonRule = (input: {
  currentBytes: Uint8Array;
  configPath: string;
  ownership: JsonValuesOwnership;
}): Either.Either<Uint8Array, string> => {
  const document = decodeJsonConfiguration(input.currentBytes, input.configPath);
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }

  const owned = ownedRules(input.ownership);
  if (owned === undefined || !installedJsonValueMatches(owned.installed, document.right.rules)) {
    return Either.left("Receipted Continue rules changed after installation.");
  }

  if (owned.previous._tag === "value") {
    const previousRules = owned.previous.value;

    return isInstructionReferences(previousRules)
      ? Either.right(textEncoder.encode(replaceRules(document.right.source, previousRules)))
      : Either.left("Prior Continue rules must be a string array.");
  }

  return Either.map(removeInsertedJsonRules(document.right.source), (source) =>
    !input.ownership.filePreviouslyPresent && jsonObjectIsEmpty(source) ? new Uint8Array() : textEncoder.encode(source),
  );
};
