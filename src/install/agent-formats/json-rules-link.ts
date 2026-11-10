/** Continue's JSON config: add or remove one instruction path in its top-level `rules` array, keeping the user's other bytes. */

import { applyEdits, type Node as JsonNode, modify, parseTree } from "jsonc-parser";
import { z } from "zod";

import { joinZodIssueMessages } from "../../zod-issue-messages.js";
import { decodeStrictText, lineEnding } from "../file-bytes.js";
import { findDuplicateJsonKey } from "../find-duplicate-json-key.js";
import { readErrorMessage } from "../install-request.js";
import { encodeJson, hashJsonValue, jsonPropertyName } from "../json-edit.js";
import type { InstalledJsonValue, JsonValuesOwnership, PreviousJsonValue } from "../ownership.js";

const textEncoder = new TextEncoder();
const RULES_KEY = "rules";
const RULES_POINTER = "/rules";
const RECEIPTED_RULES_CHANGED_MESSAGE = "Receipted Continue rules changed after installation.";
const instructionReferencesSchema = z.array(z.string());
const jsonConfigurationSchema = z.object({ rules: instructionReferencesSchema.optional() });
const jsonObjectSchema = z.record(z.string(), z.unknown());

interface JsonRulesLink {
  readonly currentBytes: Uint8Array | undefined;
  readonly configPath: string;
  readonly instructionPath: string;
  readonly previousOwnership: JsonValuesOwnership | null;
}

interface JsonConfiguration {
  readonly source: string;
  readonly rules: ReadonlyArray<string> | undefined;
}

const isInstructionReferences = (value: unknown): value is ReadonlyArray<string> =>
  instructionReferencesSchema.safeParse(value).success;

const ownedRules = (ownership: JsonValuesOwnership) =>
  ownership.values.find((value) => value.pointer === RULES_POINTER);

const installedJsonValueMatches = (installed: InstalledJsonValue, value: unknown): boolean =>
  value !== undefined && hashJsonValue(value) === installed.hash;

export const jsonRulesOwnershipIsValid = (ownership: JsonValuesOwnership): boolean => {
  const owned = ownership.values[0];

  return (
    ownership.values.length === 1 &&
    ownership.createdContainers.length === 0 &&
    owned?.pointer === RULES_POINTER &&
    owned.installed._tag === "value" &&
    (owned.previous._tag === "missing" || isInstructionReferences(owned.previous.value))
  );
};

const parseJsonObjectNode = (source: string): JsonNode => {
  const root = parseTree(source, [], { allowTrailingComma: false, disallowComments: true });
  const isRootObject = root != null && root.type === "object";
  if (!isRootObject) {
    throw new Error("Continue configuration must be one JSON object.");
  }

  return root;
};

const insertMissingJsonRules = (source: string, rules: ReadonlyArray<string>): string => {
  const root = parseJsonObjectNode(source);
  const lastProperty = root.children?.at(-1);
  const isRootEmpty = lastProperty == null;
  const insertionIndex = isRootEmpty ? root.offset + 1 : lastProperty.offset + lastProperty.length;
  const separator = isRootEmpty ? "" : ",";

  const encodedRules = encodeJson(rules);

  return `${source.slice(0, insertionIndex)}${separator}"${RULES_KEY}":${encodedRules}${source.slice(insertionIndex)}`;
};

const removeRulesAfterPrecedingProperty = (input: {
  source: string;
  rulesProperty: JsonNode;
  previousProperty: JsonNode;
}): string => {
  const previousEnd = input.previousProperty.offset + input.previousProperty.length;
  const rulesEnd = input.rulesProperty.offset + input.rulesProperty.length;
  const commaOffset = input.source.slice(previousEnd, input.rulesProperty.offset).lastIndexOf(",");
  const isCommaMissing = commaOffset < 0;
  if (isCommaMissing) {
    throw new Error("Continue rules member has no stable preceding comma.");
  }

  return `${input.source.slice(0, previousEnd + commaOffset)}${input.source.slice(rulesEnd)}`;
};

const removeRulesBeforeFollowingProperty = (input: {
  source: string;
  rulesProperty: JsonNode;
  nextProperty: JsonNode;
}): string => {
  const rulesEnd = input.rulesProperty.offset + input.rulesProperty.length;
  const commaOffset = input.source.slice(rulesEnd, input.nextProperty.offset).indexOf(",");
  const isCommaMissing = commaOffset < 0;
  if (isCommaMissing) {
    throw new Error("Continue rules member has no stable following comma.");
  }

  return `${input.source.slice(0, input.rulesProperty.offset)}${input.source.slice(rulesEnd + commaOffset + 1)}`;
};

// Removes the member together with the comma that joined it to a neighbour, so the rest stays byte-identical.
const removeInsertedJsonRules = (source: string): string => {
  const root = parseJsonObjectNode(source);
  const properties = root.children || [];
  const rulesIndex = properties.findIndex((property) => jsonPropertyName(property) === RULES_KEY);
  const rulesProperty = properties[rulesIndex];
  const isRulesMissing = rulesIndex < 0 || rulesProperty == null;
  if (isRulesMissing) {
    throw new Error("Receipted Continue rules member is missing.");
  }

  const rulesEnd = rulesProperty.offset + rulesProperty.length;
  const isRulesOnly = properties.length === 1;
  if (isRulesOnly) {
    return `${source.slice(0, rulesProperty.offset)}${source.slice(rulesEnd)}`;
  }

  const isRulesFirst = rulesIndex === 0;
  if (!isRulesFirst) {
    const previousProperty = properties[rulesIndex - 1];
    const isPreviousPropertyMissing = previousProperty == null;
    if (isPreviousPropertyMissing) {
      throw new Error("Continue rules member has no stable preceding property.");
    }

    return removeRulesAfterPrecedingProperty({ source, rulesProperty, previousProperty });
  }

  const nextProperty = properties[1];
  const isNextPropertyMissing = nextProperty == null;
  if (isNextPropertyMissing) {
    throw new Error("Continue rules member has no stable following property.");
  }

  return removeRulesBeforeFollowingProperty({ source, rulesProperty, nextProperty });
};

const replaceRules = (source: string, rules: ReadonlyArray<string>): string =>
  applyEdits(
    source,
    modify(source, [RULES_KEY], rules, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: lineEnding(source) },
    }),
  );

const parseConfigurationJson = (jsonText: string, filename: string): unknown => {
  try {
    return JSON.parse(jsonText);
  } catch (parseError) {
    throw new Error(`${filename} is invalid: ${readErrorMessage(parseError)}`, { cause: parseError });
  }
};

const decodeJsonConfiguration = (bytes: Uint8Array, filename: string): JsonConfiguration => {
  const textReply = decodeStrictText(bytes, filename);
  const isTextInvalid = textReply._tag === "invalid";
  if (isTextInvalid) {
    throw new Error(textReply.message);
  }

  const jsonText = textReply.fileContents;
  const duplicateProperty = findDuplicateJsonKey(jsonText);
  const isPropertyDuplicated = duplicateProperty != null;
  if (isPropertyDuplicated) {
    throw new Error(`${filename} contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`);
  }

  const configurationCheck = jsonConfigurationSchema.safeParse(parseConfigurationJson(jsonText, filename));
  const isConfigurationInvalid = !configurationCheck.success;
  if (isConfigurationInvalid) {
    throw new Error(`${filename} is invalid: ${joinZodIssueMessages(configurationCheck.error)}`);
  }

  return { source: jsonText, rules: configurationCheck.data.rules };
};

const createJsonOwnership = (input: {
  link: JsonRulesLink;
  previousRules: ReadonlyArray<string> | undefined;
  desiredRules: ReadonlyArray<string>;
}): JsonValuesOwnership => {
  const previousOwnership = input.link.previousOwnership;
  const history = previousOwnership == null ? undefined : ownedRules(previousOwnership);
  const previous: PreviousJsonValue =
    input.previousRules === undefined ? { _tag: "missing" } : { _tag: "value", value: input.previousRules };
  const hasNoPreviousOwnership = previousOwnership == null;

  return {
    _tag: "jsonValues",
    filePreviouslyPresent: hasNoPreviousOwnership
      ? input.link.currentBytes !== undefined
      : previousOwnership.filePreviouslyPresent,
    createdContainers: [],
    values: [
      {
        pointer: RULES_POINTER,
        installed: { _tag: "value", hash: hashJsonValue(input.desiredRules) },
        previous: history === undefined ? previous : history.previous,
      },
    ],
  };
};

export const addJsonRule = (link: JsonRulesLink): { bytes: Uint8Array; ownership: JsonValuesOwnership } => {
  const isFileMissing = link.currentBytes === undefined;
  const current: JsonConfiguration = isFileMissing
    ? { source: "{}\n", rules: undefined }
    : decodeJsonConfiguration(link.currentBytes, link.configPath);
  const { source, rules: previousRules } = current;
  const owned = link.previousOwnership == null ? undefined : ownedRules(link.previousOwnership);
  const isReceiptedRulesChanged =
    link.previousOwnership != null && (owned == null || !installedJsonValueMatches(owned.installed, previousRules));
  if (isReceiptedRulesChanged) {
    throw new Error(RECEIPTED_RULES_CHANGED_MESSAGE);
  }

  const isRulesMissing = previousRules == null;
  const isInstructionListed = !isRulesMissing && previousRules.includes(link.instructionPath);
  if (isInstructionListed) {
    return {
      bytes: textEncoder.encode(source),
      ownership: createJsonOwnership({ link, previousRules, desiredRules: previousRules }),
    };
  }

  const desiredRules = [...(previousRules ?? []), link.instructionPath];
  const editedSource = isRulesMissing
    ? insertMissingJsonRules(source, desiredRules)
    : replaceRules(source, desiredRules);

  return {
    bytes: textEncoder.encode(editedSource),
    ownership: createJsonOwnership({ link, previousRules, desiredRules }),
  };
};

const jsonObjectIsEmpty = (source: string): boolean => {
  const parsedSource: unknown = JSON.parse(source);
  const objectCheck = jsonObjectSchema.safeParse(parsedSource);

  return objectCheck.success && Object.keys(objectCheck.data).length === 0;
};

// Empty bytes mean the file held nothing but what the installation added, so the caller may delete it.
export const removeJsonRule = (input: {
  currentBytes: Uint8Array;
  configPath: string;
  ownership: JsonValuesOwnership;
}): Uint8Array => {
  const document = decodeJsonConfiguration(input.currentBytes, input.configPath);
  const owned = ownedRules(input.ownership);
  const isReceiptedRulesChanged = owned == null || !installedJsonValueMatches(owned.installed, document.rules);
  if (isReceiptedRulesChanged) {
    throw new Error(RECEIPTED_RULES_CHANGED_MESSAGE);
  }

  const previous = owned.previous;
  const isPreviousRulesRecorded = previous._tag === "value";
  if (isPreviousRulesRecorded) {
    const previousRules = previous.value;
    const isPreviousRulesValid = isInstructionReferences(previousRules);
    if (!isPreviousRulesValid) {
      throw new Error("Prior Continue rules must be a string array.");
    }

    return textEncoder.encode(replaceRules(document.source, previousRules));
  }

  const removedSource = removeInsertedJsonRules(document.source);
  const isFileEmptyAfterRemoval = !input.ownership.filePreviouslyPresent && jsonObjectIsEmpty(removedSource);
  if (isFileEmptyAfterRemoval) {
    return new Uint8Array();
  }

  return textEncoder.encode(removedSource);
};
