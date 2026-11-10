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
  readonly documentString: string;
  readonly rules: ReadonlyArray<string> | null;
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

const parseDocumentObjectNode = (documentString: string): JsonNode => {
  const root = parseTree(documentString, [], { allowTrailingComma: false, disallowComments: true });

  const isNotRootObject = root == null || root.type !== "object";
  if (isNotRootObject) {
    throw new Error("Continue configuration must be one JSON object.");
  }

  return root;
};

const insertMissingDocumentRules = (documentString: string, rules: ReadonlyArray<string>): string => {
  const root = parseDocumentObjectNode(documentString);
  const lastProperty = root.children?.at(-1);
  const isRootEmpty = lastProperty == null;
  const insertionIndex = isRootEmpty ? root.offset + 1 : lastProperty.offset + lastProperty.length;
  const separator = isRootEmpty ? "" : ",";

  const encodedRules = encodeDocument(rules);

  return `${documentString.slice(0, insertionIndex)}${separator}"${RULES_KEY}":${encodedRules}${documentString.slice(insertionIndex)}`;
};

const removeRulesAfterPrecedingProperty = (removal: {
  documentString: string;
  rulesProperty: JsonNode;
  previousProperty: JsonNode;
}): string => {
  const previousEnd = removal.previousProperty.offset + removal.previousProperty.length;
  const rulesEnd = removal.rulesProperty.offset + removal.rulesProperty.length;
  const commaOffset = removal.documentString.slice(previousEnd, removal.rulesProperty.offset).lastIndexOf(",");

  const isCommaMissing = commaOffset < 0;
  if (isCommaMissing) {
    throw new Error("Continue rules member has no stable preceding comma.");
  }

  return `${removal.documentString.slice(0, previousEnd + commaOffset)}${removal.documentString.slice(rulesEnd)}`;
};

const removeRulesBeforeFollowingProperty = (removal: {
  documentString: string;
  rulesProperty: JsonNode;
  nextProperty: JsonNode;
}): string => {
  const rulesEnd = removal.rulesProperty.offset + removal.rulesProperty.length;
  const commaOffset = removal.documentString.slice(rulesEnd, removal.nextProperty.offset).indexOf(",");

  const isCommaMissing = commaOffset < 0;
  if (isCommaMissing) {
    throw new Error("Continue rules member has no stable following comma.");
  }

  return `${removal.documentString.slice(0, removal.rulesProperty.offset)}${removal.documentString.slice(rulesEnd + commaOffset + 1)}`;
};

// Removes the member together with the comma that joined it to a neighbour, so the rest stays byte-identical.
const removeInsertedDocumentRules = (documentString: string): string => {
  const root = parseDocumentObjectNode(documentString);
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
    return `${documentString.slice(0, rulesProperty.offset)}${documentString.slice(rulesEnd)}`;
  }

  const isNotRulesFirst = rulesIndex !== 0;
  if (isNotRulesFirst) {
    const previousProperty = properties[rulesIndex - 1];

    const isPreviousPropertyMissing = previousProperty == null;
    if (isPreviousPropertyMissing) {
      throw new Error("Continue rules member has no stable preceding property.");
    }

    return removeRulesAfterPrecedingProperty({ documentString: documentString, rulesProperty, previousProperty });
  }

  const nextProperty = properties[1];

  const isNextPropertyMissing = nextProperty == null;
  if (isNextPropertyMissing) {
    throw new Error("Continue rules member has no stable following property.");
  }

  return removeRulesBeforeFollowingProperty({ documentString: documentString, rulesProperty, nextProperty });
};

const replaceRules = (documentString: string, rules: ReadonlyArray<string>): string =>
  applyEdits(
    documentString,
    modify(documentString, [RULES_KEY], rules, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: readLineEnding(documentString) },
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

  return { documentString: documentString, rules: configurationCheck.data.rules ?? null };
};

const createDocumentOwnership = (creation: {
  link: DocumentRulesLink;
  previousRules: ReadonlyArray<string> | null;
  desiredRules: ReadonlyArray<string>;
}): DocumentFieldsOwnership => {
  const previousOwnership = creation.link.previousOwnership;

  const isPreviousOwnershipMissing = previousOwnership == null;
  const history = isPreviousOwnershipMissing ? null : readOwnedRules(previousOwnership);

  const isPreviousRulesUnset = creation.previousRules == null;
  const previous: PreviousDocumentField = isPreviousRulesUnset
    ? { _tag: "missing" }
    : { _tag: "value", value: creation.previousRules };
  const hasNoPreviousOwnership = previousOwnership == null;

  const isHistoryMissing = history == null;
  return {
    _tag: "jsonValues",
    filePreviouslyPresent: hasNoPreviousOwnership
      ? creation.link.currentBytes != null
      : previousOwnership.filePreviouslyPresent,
    createdContainers: [],
    values: [
      {
        pointer: RULES_POINTER,
        installed: { _tag: "value", hash: hashDocumentField(creation.desiredRules) },
        previous: isHistoryMissing ? previous : history.previous,
      },
    ],
  };
};

export const addDocumentRule = (link: DocumentRulesLink): { bytes: Uint8Array; ownership: DocumentFieldsOwnership } => {
  const isFileMissing = link.currentBytes == null;
  const current: DocumentConfiguration = isFileMissing
    ? { documentString: "{}\n", rules: null }
    : decodeDocumentConfiguration(link.currentBytes, link.configPath);
  const { documentString, rules: previousRules } = current;

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
      bytes: stringEncoder.encode(documentString),
      ownership: createDocumentOwnership({ link, previousRules, desiredRules: previousRules }),
    };
  }

  const desiredRules = [...(previousRules ?? []), link.instructionPath];
  const editedOrigin = isRulesMissing
    ? insertMissingDocumentRules(documentString, desiredRules)
    : replaceRules(documentString, desiredRules);

  return {
    bytes: stringEncoder.encode(editedOrigin),
    ownership: createDocumentOwnership({ link, previousRules, desiredRules }),
  };
};

const isDocumentObjectEmpty = (documentString: string): boolean => {
  const parsedDocument: unknown = JSON.parse(documentString);
  const objectCheck = documentObjectSchema.safeParse(parsedDocument);

  return objectCheck.success && Object.keys(objectCheck.data).length === 0;
};

// Empty bytes mean the file held nothing but what the installation added, so the caller may delete it.
export const removeDocumentRule = (removal: {
  currentBytes: Uint8Array;
  configPath: string;
  ownership: DocumentFieldsOwnership;
}): Uint8Array => {
  const document = decodeDocumentConfiguration(removal.currentBytes, removal.configPath);
  const owned = readOwnedRules(removal.ownership);

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

    return stringEncoder.encode(replaceRules(document.documentString, previousRules));
  }

  const documentStringWithoutRules = removeInsertedDocumentRules(document.documentString);

  const isFileEmptyAfterRemoval =
    !removal.ownership.filePreviouslyPresent && isDocumentObjectEmpty(documentStringWithoutRules);
  if (isFileEmptyAfterRemoval) {
    return new Uint8Array();
  }

  return stringEncoder.encode(documentStringWithoutRules);
};
