import { applyEdits, type Node as JsonNode, modify, parseTree } from "jsonc-parser";
import { z } from "zod";
import { decodeStrictString, readLineEnding } from "#src/install/file-bytes.js";
import { findDuplicateJsonKey } from "#src/install/find-duplicate-json-key.js";
import { readErrorMessage } from "#src/install/install-request.js";
import { encodeDocument, hashDocumentField, readDocumentPropertyName } from "#src/install/json-edit.js";
import type { DocumentFieldsOwnership, InstalledDocumentField, PreviousDocumentField } from "#src/install/ownership.js";
import { joinZodIssueMessages } from "#src/zod-issue-messages.js";

const stringEncoder = new TextEncoder();
const RULES_KEY = "rules";
const RULES_POINTER = "/rules";
const RECEIPTED_RULES_CHANGED_MESSAGE = "Receipted Continue rules changed after installation.";
const instructionReferencesSchema = z.array(z.string());
const documentConfigurationSchema = z.object({ rules: instructionReferencesSchema.optional() });
const documentObjectSchema = z.record(z.string(), z.unknown());

interface DocumentRulesLink {
  readonly currentBytes: Uint8Array | null;
  readonly configPath: string;
  readonly instructionPath: string;
  readonly previousOwnership: DocumentFieldsOwnership | null;
}

interface DocumentConfiguration {
  readonly source: string;
  readonly rules: ReadonlyArray<string> | undefined;
}

const isInstructionReferences = (field: unknown): field is ReadonlyArray<string> =>
  instructionReferencesSchema.safeParse(field).success;

const readOwnedRules = (ownership: DocumentFieldsOwnership) =>
  ownership.values.find((field) => field.pointer === RULES_POINTER) ?? null;

const isInstalledDocumentFieldEqual = (installed: InstalledDocumentField, field: unknown): boolean =>
  field != null && hashDocumentField(field) === installed.hash;

export const isDocumentRulesOwnershipIsValid = (ownership: DocumentFieldsOwnership): boolean => {
  const owned = ownership.values[0];

  return (
    ownership.values.length === 1 &&
    ownership.createdContainers.length === 0 &&
    owned?.pointer === RULES_POINTER &&
    owned.installed._tag === "value" &&
    (owned.previous._tag === "missing" || isInstructionReferences(owned.previous.value))
  );
};

const parseDocumentObjectNode = (code: string): JsonNode => {
  const root = parseTree(code, [], { allowTrailingComma: false, disallowComments: true });

  const isNotRootObject = root == null || root.type !== "object";
  if (isNotRootObject) {
    throw new Error("Continue configuration must be one JSON object.");
  }

  return root;
};

const insertMissingDocumentRules = (code: string, rules: ReadonlyArray<string>): string => {
  const root = parseDocumentObjectNode(code);
  const lastProperty = root.children?.at(-1);
  const isRootEmpty = lastProperty == null;
  const insertionIndex = isRootEmpty ? root.offset + 1 : lastProperty.offset + lastProperty.length;
  const separator = isRootEmpty ? "" : ",";

  const encodedRules = encodeDocument(rules);

  return `${code.slice(0, insertionIndex)}${separator}"${RULES_KEY}":${encodedRules}${code.slice(insertionIndex)}`;
};

const removeRulesAfterPrecedingProperty = (details: {
  source: string;
  rulesProperty: JsonNode;
  previousProperty: JsonNode;
}): string => {
  const previousEnd = details.previousProperty.offset + details.previousProperty.length;
  const rulesEnd = details.rulesProperty.offset + details.rulesProperty.length;
  const commaOffset = details.source.slice(previousEnd, details.rulesProperty.offset).lastIndexOf(",");

  const isCommaMissing = commaOffset < 0;
  if (isCommaMissing) {
    throw new Error("Continue rules member has no stable preceding comma.");
  }

  return `${details.source.slice(0, previousEnd + commaOffset)}${details.source.slice(rulesEnd)}`;
};

const removeRulesBeforeFollowingProperty = (details: {
  source: string;
  rulesProperty: JsonNode;
  nextProperty: JsonNode;
}): string => {
  const rulesEnd = details.rulesProperty.offset + details.rulesProperty.length;
  const commaOffset = details.source.slice(rulesEnd, details.nextProperty.offset).indexOf(",");

  const isCommaMissing = commaOffset < 0;
  if (isCommaMissing) {
    throw new Error("Continue rules member has no stable following comma.");
  }

  return `${details.source.slice(0, details.rulesProperty.offset)}${details.source.slice(rulesEnd + commaOffset + 1)}`;
};

// Removes the member together with the comma that joined it to a neighbour, so the rest stays byte-identical.
const removeInsertedDocumentRules = (code: string): string => {
  const root = parseDocumentObjectNode(code);
  const properties = root.children || [];
  const rulesIndex = properties.findIndex((property) => readDocumentPropertyName(property) === RULES_KEY);
  const rulesProperty = properties[rulesIndex];

  const isRulesMissing = rulesIndex < 0 || rulesProperty == null;
  if (isRulesMissing) {
    throw new Error("Receipted Continue rules member is missing.");
  }

  const rulesEnd = rulesProperty.offset + rulesProperty.length;

  const isRulesOnly = properties.length === 1;
  if (isRulesOnly) {
    return `${code.slice(0, rulesProperty.offset)}${code.slice(rulesEnd)}`;
  }

  const isNotRulesFirst = rulesIndex !== 0;
  if (isNotRulesFirst) {
    const previousProperty = properties[rulesIndex - 1];

    const isPreviousPropertyMissing = previousProperty == null;
    if (isPreviousPropertyMissing) {
      throw new Error("Continue rules member has no stable preceding property.");
    }

    return removeRulesAfterPrecedingProperty({ source: code, rulesProperty, previousProperty });
  }

  const nextProperty = properties[1];

  const isNextPropertyMissing = nextProperty == null;
  if (isNextPropertyMissing) {
    throw new Error("Continue rules member has no stable following property.");
  }

  return removeRulesBeforeFollowingProperty({ source: code, rulesProperty, nextProperty });
};

const replaceRules = (code: string, rules: ReadonlyArray<string>): string =>
  applyEdits(
    code,
    modify(code, [RULES_KEY], rules, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: readLineEnding(code) },
    }),
  );

const parseConfigurationDocument = (documentString: string, filename: string): unknown => {
  try {
    return JSON.parse(documentString);
  } catch (parseError) {
    throw new Error(`${filename} is invalid: ${readErrorMessage(parseError)}`, { cause: parseError });
  }
};

const decodeDocumentConfiguration = (bytes: Uint8Array, filename: string): DocumentConfiguration => {
  const stringReply = decodeStrictString(bytes, filename);

  const isStringInvalid = stringReply._tag === "invalid";
  if (isStringInvalid) {
    throw new Error(stringReply.message);
  }

  const documentString = stringReply.fileContents;
  const duplicateProperty = findDuplicateJsonKey(documentString);

  const isPropertyDuplicated = duplicateProperty != null;
  if (isPropertyDuplicated) {
    throw new Error(`${filename} contains duplicate JSON property ${JSON.stringify(duplicateProperty)}.`);
  }

  const configurationCheck = documentConfigurationSchema.safeParse(
    parseConfigurationDocument(documentString, filename),
  );

  const isConfigurationInvalid = !configurationCheck.success;
  if (isConfigurationInvalid) {
    throw new Error(`${filename} is invalid: ${joinZodIssueMessages(configurationCheck.error)}`);
  }

  return { source: documentString, rules: configurationCheck.data.rules };
};

const createDocumentOwnership = (details: {
  link: DocumentRulesLink;
  previousRules: ReadonlyArray<string> | undefined;
  desiredRules: ReadonlyArray<string>;
}): DocumentFieldsOwnership => {
  const previousOwnership = details.link.previousOwnership;

  const isPreviousOwnershipMissing = previousOwnership == null;
  const history = isPreviousOwnershipMissing ? null : readOwnedRules(previousOwnership);

  const isPreviousRulesUnset = details.previousRules == null;
  const previous: PreviousDocumentField = isPreviousRulesUnset
    ? { _tag: "missing" }
    : { _tag: "value", value: details.previousRules };
  const hasNoPreviousOwnership = previousOwnership == null;

  const isHistoryMissing = history == null;
  return {
    _tag: "jsonValues",
    filePreviouslyPresent: hasNoPreviousOwnership
      ? details.link.currentBytes != null
      : previousOwnership.filePreviouslyPresent,
    createdContainers: [],
    values: [
      {
        pointer: RULES_POINTER,
        installed: { _tag: "value", hash: hashDocumentField(details.desiredRules) },
        previous: isHistoryMissing ? previous : history.previous,
      },
    ],
  };
};

export const addDocumentRule = (link: DocumentRulesLink): { bytes: Uint8Array; ownership: DocumentFieldsOwnership } => {
  const isFileMissing = link.currentBytes == null;
  const current: DocumentConfiguration = isFileMissing
    ? { source: "{}\n", rules: undefined }
    : decodeDocumentConfiguration(link.currentBytes, link.configPath);
  const { source: code, rules: previousRules } = current;

  const isLinkPreviousOwnershipMissing = link.previousOwnership == null;
  const owned = isLinkPreviousOwnershipMissing ? null : readOwnedRules(link.previousOwnership);

  const isReceiptedRulesChanged =
    link.previousOwnership != null && (owned == null || !isInstalledDocumentFieldEqual(owned.installed, previousRules));
  if (isReceiptedRulesChanged) {
    throw new Error(RECEIPTED_RULES_CHANGED_MESSAGE);
  }

  const isRulesMissing = previousRules == null;

  const isInstructionListed = !isRulesMissing && previousRules.includes(link.instructionPath);
  if (isInstructionListed) {
    return {
      bytes: stringEncoder.encode(code),
      ownership: createDocumentOwnership({ link, previousRules, desiredRules: previousRules }),
    };
  }

  const desiredRules = [...(previousRules ?? []), link.instructionPath];
  const editedOrigin = isRulesMissing
    ? insertMissingDocumentRules(code, desiredRules)
    : replaceRules(code, desiredRules);

  return {
    bytes: stringEncoder.encode(editedOrigin),
    ownership: createDocumentOwnership({ link, previousRules, desiredRules }),
  };
};

const isDocumentObjectIsEmpty = (code: string): boolean => {
  const parsedOrigin: unknown = JSON.parse(code);
  const objectCheck = documentObjectSchema.safeParse(parsedOrigin);

  return objectCheck.success && Object.keys(objectCheck.data).length === 0;
};

// Empty bytes mean the file held nothing but what the installation added, so the caller may delete it.
export const removeDocumentRule = (details: {
  currentBytes: Uint8Array;
  configPath: string;
  ownership: DocumentFieldsOwnership;
}): Uint8Array => {
  const document = decodeDocumentConfiguration(details.currentBytes, details.configPath);
  const owned = readOwnedRules(details.ownership);

  const isReceiptedRulesChanged = owned == null || !isInstalledDocumentFieldEqual(owned.installed, document.rules);
  if (isReceiptedRulesChanged) {
    throw new Error(RECEIPTED_RULES_CHANGED_MESSAGE);
  }

  const previous = owned.previous;

  const isPreviousRulesRecorded = previous._tag === "value";
  if (isPreviousRulesRecorded) {
    const previousRules = previous.value;

    const isNotPreviousRulesValid = !isInstructionReferences(previousRules);
    if (isNotPreviousRulesValid) {
      throw new Error("Prior Continue rules must be a string array.");
    }

    return stringEncoder.encode(replaceRules(document.source, previousRules));
  }

  const removedOrigin = removeInsertedDocumentRules(document.source);

  const isFileEmptyAfterRemoval = !details.ownership.filePreviouslyPresent && isDocumentObjectIsEmpty(removedOrigin);
  if (isFileEmptyAfterRemoval) {
    return new Uint8Array();
  }

  return stringEncoder.encode(removedOrigin);
};
