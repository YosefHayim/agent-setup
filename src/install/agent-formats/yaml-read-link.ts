import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import { decodeStrictString, readLineEnding } from "#src/install/file-bytes.js";
import type { YamlSequenceFieldOwnership } from "#src/install/ownership.js";

const stringEncoder = new TextEncoder();

interface YamlReadLink {
  readonly currentBytes: Uint8Array | null;
  readonly configPath: string;
  readonly instructionPath: string;
  readonly previousOwnership: YamlSequenceFieldOwnership | null;
}

interface YamlReadBlock {
  readonly _tag: "block";
  readonly documentString: string;
  readonly pairStart: number;
  readonly pairEnd: number;
  readonly insertionIndex: number;
  readonly itemPrefix: string;
  readonly references: ReadonlyArray<{ readonly reference: string; readonly start: number; readonly end: number }>;
}

type YamlReadDocument = { readonly _tag: "missing"; readonly documentString: string } | YamlReadBlock;
type YamlInsertedPrefix = YamlSequenceFieldOwnership["insertedPrefix"];

const readLineStartAt = (documentString: string, index: number): number =>
  documentString.lastIndexOf("\n", index - 1) + 1;

const readLineEndAfter = (documentString: string, index: number): number => {
  const lineFeed = documentString.indexOf("\n", index);

  const isLineFeedMissing = lineFeed < 0;
  return isLineFeedMissing ? documentString.length : lineFeed + 1;
};

const readSettingsString = (bytes: Uint8Array, settingsPath: string): string => {
  const stringReply = decodeStrictString(bytes, settingsPath);

  const isStringInvalid = stringReply._tag === "invalid";
  if (isStringInvalid) {
    throw new Error(stringReply.message);
  }

  return stringReply.fileContents;
};

const inspectYamlReadDocument = (documentString: string): YamlReadDocument => {
  const hasTabOrLoneReturn = documentString.includes("\t") || /\r(?!\n)/.test(documentString);
  if (hasTabOrLoneReturn) {
    throw new Error("Aider configuration is invalid: use spaces with LF or CRLF line endings.");
  }

  const document = parseDocument(documentString, { keepSourceTokens: true, uniqueKeys: true });

  const hasParseErrors = document.errors.length > 0;
  if (hasParseErrors) {
    throw new Error(`Aider configuration is invalid: ${document.errors.map((error) => error.message).join("; ")}`);
  }

  const rootNode = document.contents;

  const isDocumentEmpty = rootNode == null;
  if (isDocumentEmpty) {
    return { _tag: "missing", documentString };
  }

  const isBlockMapping = isMap(rootNode) && rootNode.flow !== true;

  const isNotBlockMapping = !isBlockMapping;
  if (isNotBlockMapping) {
    throw new Error("Aider configuration must be one block mapping.");
  }

  const pair = rootNode.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === "read");

  const isReadKeyMissing = pair == null;
  if (isReadKeyMissing) {
    return { _tag: "missing", documentString };
  }

  const keyScalar = isScalar(pair.key) ? pair.key : null;
  const keyRange = keyScalar?.range;

  const isKeyRangeMissing = keyRange == null;
  if (isKeyRangeMissing) {
    throw new Error("Aider read key has no stable source range.");
  }

  const isReadFieldEmpty = pair.value === null;
  if (isReadFieldEmpty) {
    const pairEnd = readLineEndAfter(documentString, keyRange[2]);

    return {
      _tag: "block",
      documentString,
      pairStart: keyRange[0],
      pairEnd,
      insertionIndex: pairEnd,
      itemPrefix: "  - ",
      references: [],
    };
  }

  const pairNode = pair.value;
  const isBlockSequenceNode = isSeq(pairNode) && pairNode.flow !== true;
  const readSequence = isBlockSequenceNode ? pairNode : null;
  const sequenceRange = readSequence?.range;

  const isReadBlockSequenceMissing = readSequence == null || sequenceRange == null;
  if (isReadBlockSequenceMissing) {
    throw new Error("Aider read must be one block sequence of strings.");
  }

  const references = [];
  let referencePrefix: string | null = null;
  for (const referenceNode of readSequence.items) {
    const referenceScalar = isScalar(referenceNode) ? referenceNode : null;
    const referenceValue = referenceScalar?.value;
    const referenceRange = referenceScalar?.range;
    const isDirectString =
      typeof referenceValue === "string" &&
      referenceRange != null &&
      referenceScalar?.anchor == null &&
      referenceScalar?.tag == null;

    const isNotDirectString = !isDirectString;
    if (isNotDirectString) {
      throw new Error("Aider read must contain only direct string values.");
    }

    const start = readLineStartAt(documentString, referenceRange[0]);
    const prefix = documentString.slice(start, referenceRange[0]);
    const isPrefixConsistent = /^ +-\s+$/.test(prefix) && (referencePrefix == null || referencePrefix === prefix);

    const isNotPrefixConsistent = !isPrefixConsistent;
    if (isNotPrefixConsistent) {
      throw new Error("Aider read must use one consistent space-indented block sequence.");
    }

    referencePrefix = prefix;
    references.push({ reference: referenceValue, start, end: referenceRange[2] });
  }

  const lastReference = references.at(-1);
  const isInsertingAtSequenceEnd = documentString.endsWith("\n") || lastReference == null;
  const insertionIndex = isInsertingAtSequenceEnd ? sequenceRange[2] : lastReference.start;

  return {
    _tag: "block",
    documentString,
    pairStart: keyRange[0],
    pairEnd: sequenceRange[2],
    insertionIndex,
    itemPrefix: referencePrefix ?? "  - ",
    references: references,
  };
};

const listYamlReferences = (document: YamlReadDocument, reference: string) => {
  const isDocumentMissing = document._tag === "missing";
  return isDocumentMissing ? [] : document.references.filter((readReference) => readReference.reference === reference);
};

const appendYamlReference = ({
  document,
  reference,
}: {
  document: YamlReadDocument;
  reference: string;
}): {
  documentString: string;
  insertedPrefix: YamlInsertedPrefix;
  keyPreviouslyPresent: boolean;
} => {
  const ending = readLineEnding(document.documentString);

  const isDocumentMissing = document._tag === "missing";
  if (isDocumentMissing) {
    const isDocumentEmpty = document.documentString.length === 0;
    const insertedPrefix = isDocumentEmpty ? "" : ending;

    return {
      documentString: `${document.documentString}${insertedPrefix}read:${ending}  - ${reference}${ending}`,
      insertedPrefix,
      keyPreviouslyPresent: false,
    };
  }

  const isReferenceInstalled = listYamlReferences(document, reference).length > 0;
  if (isReferenceInstalled) {
    return { documentString: document.documentString, insertedPrefix: "", keyPreviouslyPresent: true };
  }

  const referenceLine = `${document.itemPrefix}${reference}${ending}`;

  return {
    documentString: `${document.documentString.slice(0, document.insertionIndex)}${referenceLine}${document.documentString.slice(document.insertionIndex)}`,
    insertedPrefix: "",
    keyPreviouslyPresent: true,
  };
};

const createYamlOwnership = ({
  link,
  keyPreviouslyPresent,
  insertedPrefix,
  previouslyPresent,
}: {
  link: YamlReadLink;
  keyPreviouslyPresent: boolean;
  insertedPrefix: YamlInsertedPrefix;
  previouslyPresent: boolean;
}): YamlSequenceFieldOwnership =>
  link.previousOwnership ?? {
    _tag: "yamlSequenceValue",
    filePreviouslyPresent: link.currentBytes != null,
    key: "read",
    keyPreviouslyPresent,
    insertedPrefix,
    reference: link.instructionPath,
    previouslyPresent,
  };

const readCurrentString = (link: YamlReadLink): string => {
  const currentBytes = link.currentBytes;

  const isFileMissing = currentBytes == null;
  if (isFileMissing) {
    return "";
  }

  return readSettingsString(currentBytes, link.configPath);
};

export const addYamlRead = (link: YamlReadLink): { bytes: Uint8Array; ownership: YamlSequenceFieldOwnership } => {
  const currentString = readCurrentString(link);
  const document = inspectYamlReadDocument(currentString);

  const isLineUnterminated =
    document._tag === "block" &&
    document.references.length === 0 &&
    document.documentString.length > 0 &&
    !document.documentString.endsWith("\n");
  if (isLineUnterminated) {
    throw new Error("Aider read key must end its line before a reference can be added.");
  }

  const referenceElements = listYamlReferences(document, link.instructionPath);

  const isReceiptedReferenceChanged = link.previousOwnership != null && referenceElements.length !== 1;
  if (isReceiptedReferenceChanged) {
    throw new Error("Receipted Aider read reference changed after installation.");
  }

  const isReferenceDuplicated = referenceElements.length > 1;
  if (isReferenceDuplicated) {
    throw new Error("Aider read contains the managed reference more than once.");
  }

  const desiredYaml = appendYamlReference({ document, reference: link.instructionPath });

  return {
    bytes: stringEncoder.encode(desiredYaml.documentString),
    ownership: createYamlOwnership({
      link,
      keyPreviouslyPresent: desiredYaml.keyPreviouslyPresent,
      insertedPrefix: desiredYaml.insertedPrefix,
      previouslyPresent: referenceElements.length === 1,
    }),
  };
};

const removeInsertedYamlKey = ({
  documentString,
  document,
  ownership,
}: {
  documentString: string;
  document: YamlReadBlock;
  ownership: YamlSequenceFieldOwnership;
}): Uint8Array => {
  const ending = readLineEnding(documentString);
  const expectedPair = `read:${ending}${document.itemPrefix}${ownership.reference}${ending}`;

  const installedPair = documentString.slice(document.pairStart, document.pairEnd);

  const isPairChanged = installedPair !== expectedPair;
  if (isPairChanged) {
    throw new Error("Receipted Aider key pair changed after installation.");
  }

  const prefixStart = document.pairStart - ownership.insertedPrefix.length;

  const isPrefixFramingChanged =
    prefixStart < 0 || documentString.slice(prefixStart, document.pairStart) !== ownership.insertedPrefix;
  if (isPrefixFramingChanged) {
    throw new Error("Receipted Aider key framing changed after installation.");
  }

  const prefix = documentString.slice(0, prefixStart);
  const suffix = documentString.slice(document.pairEnd);
  const suffixStartsLineEnding = suffix.startsWith("\n") || suffix.startsWith("\r\n");
  const isSeparatorNeeded = prefix.length > 0 && suffix.length > 0 && !prefix.endsWith("\n") && !suffixStartsLineEnding;
  const separator = isSeparatorNeeded ? ending : "";

  return stringEncoder.encode(`${prefix}${separator}${suffix}`);
};

// Empty bytes mean the file held nothing but what the installation added, so the caller may delete it.
export const removeYamlRead = ({
  currentBytes,
  configPath: settingsPath,
  ownership,
}: {
  currentBytes: Uint8Array;
  configPath: string;
  ownership: YamlSequenceFieldOwnership;
}): Uint8Array => {
  const settingsYaml = readSettingsString(currentBytes, settingsPath);
  const document = inspectYamlReadDocument(settingsYaml);

  const isDocumentMissing = document._tag === "missing";
  if (isDocumentMissing) {
    throw new Error("Receipted Aider read reference changed after installation.");
  }

  const referenceElements = listYamlReferences(document, ownership.reference);
  const referenceElement = referenceElements[0];
  const isReferenceUnique = referenceElements.length === 1 && referenceElement != null;

  const isReferenceNotUnique = !isReferenceUnique;
  if (isReferenceNotUnique) {
    throw new Error("Receipted Aider read reference changed after installation.");
  }

  const wasPreviouslyPresent = ownership.previouslyPresent;
  if (wasPreviouslyPresent) {
    return stringEncoder.encode(settingsYaml);
  }

  const installedReferenceLine = settingsYaml.slice(referenceElement.start, referenceElement.end);

  const expectedReferenceLine = `${document.itemPrefix}${ownership.reference}${readLineEnding(settingsYaml)}`;

  const isReferenceLineChanged = installedReferenceLine !== expectedReferenceLine;
  if (isReferenceLineChanged) {
    throw new Error("Receipted Aider reference line changed after installation.");
  }

  const isInsertedKeyOnly = !ownership.keyPreviouslyPresent && document.references.length === 1;
  if (isInsertedKeyOnly) {
    return removeInsertedYamlKey({ documentString: settingsYaml, document, ownership });
  }

  return stringEncoder.encode(
    `${settingsYaml.slice(0, referenceElement.start)}${settingsYaml.slice(referenceElement.end)}`,
  );
};
