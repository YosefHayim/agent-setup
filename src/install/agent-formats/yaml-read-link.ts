import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import { decodeStrictText, lineEnding } from "#src/install/file-bytes.js";
import type { YamlSequenceValueOwnership } from "#src/install/ownership.js";

const textEncoder = new TextEncoder();

interface YamlReadLink {
  readonly currentBytes: Uint8Array | undefined;
  readonly configPath: string;
  readonly instructionPath: string;
  readonly previousOwnership: YamlSequenceValueOwnership | null;
}

interface YamlReadBlock {
  readonly _tag: "block";
  readonly source: string;
  readonly pairStart: number;
  readonly pairEnd: number;
  readonly insertionIndex: number;
  readonly itemPrefix: string;
  readonly items: ReadonlyArray<{ readonly value: string; readonly start: number; readonly end: number }>;
}

type YamlReadDocument = { readonly _tag: "missing"; readonly source: string } | YamlReadBlock;
type YamlInsertedPrefix = YamlSequenceValueOwnership["insertedPrefix"];

const lineStartAt = (source: string, index: number): number => source.lastIndexOf("\n", index - 1) + 1;

const lineEndAfter = (source: string, index: number): number => {
  const lineFeed = source.indexOf("\n", index);

  return lineFeed < 0 ? source.length : lineFeed + 1;
};

const readConfigText = (bytes: Uint8Array, configPath: string): string => {
  const textReply = decodeStrictText(bytes, configPath);
  const isTextInvalid = textReply._tag === "invalid";
  if (isTextInvalid) {
    throw new Error(textReply.message);
  }

  return textReply.fileContents;
};

const inspectYamlReadDocument = (source: string): YamlReadDocument => {
  const hasTabOrLoneReturn = source.includes("\t") || /\r(?!\n)/.test(source);
  if (hasTabOrLoneReturn) {
    throw new Error("Aider configuration is invalid: use spaces with LF or CRLF line endings.");
  }

  const document = parseDocument(source, { keepSourceTokens: true, uniqueKeys: true });
  const hasParseErrors = document.errors.length > 0;
  if (hasParseErrors) {
    throw new Error(`Aider configuration is invalid: ${document.errors.map((error) => error.message).join("; ")}`);
  }

  const contents = document.contents;
  const isDocumentEmpty = contents == null;
  if (isDocumentEmpty) {
    return { _tag: "missing", source };
  }

  const isBlockMapping = isMap(contents) && contents.flow !== true;

  const isNotBlockMapping = !isBlockMapping;
  if (isNotBlockMapping) {
    throw new Error("Aider configuration must be one block mapping.");
  }

  const pair = contents.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === "read");
  const isReadKeyMissing = pair === undefined;
  if (isReadKeyMissing) {
    return { _tag: "missing", source };
  }

  const keyScalar = isScalar(pair.key) ? pair.key : null;
  const keyRange = keyScalar?.range;
  const isKeyRangeMissing = keyRange == null;
  if (isKeyRangeMissing) {
    throw new Error("Aider read key has no stable source range.");
  }

  const isReadValueEmpty = pair.value === null;
  if (isReadValueEmpty) {
    const pairEnd = lineEndAfter(source, keyRange[2]);

    return {
      _tag: "block",
      source,
      pairStart: keyRange[0],
      pairEnd,
      insertionIndex: pairEnd,
      itemPrefix: "  - ",
      items: [],
    };
  }

  const readSequence = isSeq(pair.value) && pair.value.flow !== true ? pair.value : null;
  const sequenceRange = readSequence?.range;

  const isReadBlockSequenceMissing = readSequence == null || sequenceRange == null;
  if (isReadBlockSequenceMissing) {
    throw new Error("Aider read must be one block sequence of strings.");
  }

  const items = [];
  let itemPrefix: string | undefined;
  for (const sequenceItem of readSequence.items) {
    const itemScalar = isScalar(sequenceItem) ? sequenceItem : null;
    const itemValue = itemScalar?.value;
    const itemRange = itemScalar?.range;
    const isDirectString =
      typeof itemValue === "string" &&
      itemRange != null &&
      itemScalar?.anchor === undefined &&
      itemScalar?.tag === undefined;

    const isNotDirectString = !isDirectString;
    if (isNotDirectString) {
      throw new Error("Aider read must contain only direct string values.");
    }

    const start = lineStartAt(source, itemRange[0]);
    const prefix = source.slice(start, itemRange[0]);
    const isPrefixConsistent = /^ +-\s+$/.test(prefix) && (itemPrefix === undefined || itemPrefix === prefix);

    const isNotPrefixConsistent = !isPrefixConsistent;
    if (isNotPrefixConsistent) {
      throw new Error("Aider read must use one consistent space-indented block sequence.");
    }

    itemPrefix = prefix;
    items.push({ value: itemValue, start, end: itemRange[2] });
  }

  const lastItem = items.at(-1);
  const insertionIndex = source.endsWith("\n") || lastItem === undefined ? sequenceRange[2] : lastItem.start;

  return {
    _tag: "block",
    source,
    pairStart: keyRange[0],
    pairEnd: sequenceRange[2],
    insertionIndex,
    itemPrefix: itemPrefix === undefined ? "  - " : itemPrefix,
    items,
  };
};

const yamlReferenceItems = (document: YamlReadDocument, reference: string) =>
  document._tag === "missing" ? [] : document.items.filter((item) => item.value === reference);

const appendYamlReference = ({
  document,
  reference,
}: {
  document: YamlReadDocument;
  reference: string;
}): {
  source: string;
  insertedPrefix: YamlInsertedPrefix;
  keyPreviouslyPresent: boolean;
} => {
  const ending = lineEnding(document.source);

  const isDocumentMissing = document._tag === "missing";
  if (isDocumentMissing) {
    const insertedPrefix = document.source.length === 0 ? "" : ending;

    return {
      source: `${document.source}${insertedPrefix}read:${ending}  - ${reference}${ending}`,
      insertedPrefix,
      keyPreviouslyPresent: false,
    };
  }

  const isReferenceInstalled = yamlReferenceItems(document, reference).length > 0;
  if (isReferenceInstalled) {
    return { source: document.source, insertedPrefix: "", keyPreviouslyPresent: true };
  }

  const referenceLine = `${document.itemPrefix}${reference}${ending}`;

  return {
    source: `${document.source.slice(0, document.insertionIndex)}${referenceLine}${document.source.slice(document.insertionIndex)}`,
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
}): YamlSequenceValueOwnership =>
  link.previousOwnership ?? {
    _tag: "yamlSequenceValue",
    filePreviouslyPresent: link.currentBytes !== undefined,
    key: "read",
    keyPreviouslyPresent,
    insertedPrefix,
    reference: link.instructionPath,
    previouslyPresent,
  };

const readCurrentText = (link: YamlReadLink): string => {
  const currentBytes = link.currentBytes;
  const isFileMissing = currentBytes == null;
  if (isFileMissing) {
    return "";
  }

  return readConfigText(currentBytes, link.configPath);
};

export const addYamlRead = (link: YamlReadLink): { bytes: Uint8Array; ownership: YamlSequenceValueOwnership } => {
  const currentText = readCurrentText(link);
  const document = inspectYamlReadDocument(currentText);

  const isLineUnterminated =
    document._tag === "block" &&
    document.items.length === 0 &&
    document.source.length > 0 &&
    !document.source.endsWith("\n");
  if (isLineUnterminated) {
    throw new Error("Aider read key must end its line before a reference can be added.");
  }

  const referenceItems = yamlReferenceItems(document, link.instructionPath);
  const isReceiptedReferenceChanged = link.previousOwnership != null && referenceItems.length !== 1;
  if (isReceiptedReferenceChanged) {
    throw new Error("Receipted Aider read reference changed after installation.");
  }

  const isReferenceDuplicated = referenceItems.length > 1;
  if (isReferenceDuplicated) {
    throw new Error("Aider read contains the managed reference more than once.");
  }

  const desiredYaml = appendYamlReference({ document, reference: link.instructionPath });

  return {
    bytes: textEncoder.encode(desiredYaml.source),
    ownership: createYamlOwnership({
      link,
      keyPreviouslyPresent: desiredYaml.keyPreviouslyPresent,
      insertedPrefix: desiredYaml.insertedPrefix,
      previouslyPresent: referenceItems.length === 1,
    }),
  };
};

const removeInsertedYamlKey = ({
  source,
  document,
  ownership,
}: {
  source: string;
  document: YamlReadBlock;
  ownership: YamlSequenceValueOwnership;
}): Uint8Array => {
  const ending = lineEnding(source);
  const expectedPair = `read:${ending}${document.itemPrefix}${ownership.reference}${ending}`;
  const installedPair = source.slice(document.pairStart, document.pairEnd);
  if (installedPair !== expectedPair) {
    throw new Error("Receipted Aider key pair changed after installation.");
  }

  const prefixStart = document.pairStart - ownership.insertedPrefix.length;
  const isPrefixFramingChanged =
    prefixStart < 0 || source.slice(prefixStart, document.pairStart) !== ownership.insertedPrefix;
  if (isPrefixFramingChanged) {
    throw new Error("Receipted Aider key framing changed after installation.");
  }

  const prefix = source.slice(0, prefixStart);
  const suffix = source.slice(document.pairEnd);
  const suffixStartsLineEnding = suffix.startsWith("\n") || suffix.startsWith("\r\n");
  const needsSeparator = prefix.length > 0 && suffix.length > 0 && !prefix.endsWith("\n") && !suffixStartsLineEnding;
  const separator = needsSeparator ? ending : "";

  return textEncoder.encode(`${prefix}${separator}${suffix}`);
};

// Empty bytes mean the file held nothing but what the installation added, so the caller may delete it.
export const removeYamlRead = ({
  currentBytes,
  configPath,
  ownership,
}: {
  currentBytes: Uint8Array;
  configPath: string;
  ownership: YamlSequenceValueOwnership;
}): Uint8Array => {
  const configYaml = readConfigText(currentBytes, configPath);
  const document = inspectYamlReadDocument(configYaml);
  const isDocumentMissing = document._tag === "missing";
  if (isDocumentMissing) {
    throw new Error("Receipted Aider read reference changed after installation.");
  }

  const referenceItems = yamlReferenceItems(document, ownership.reference);
  const referenceItem = referenceItems[0];
  const isReferenceUnique = referenceItems.length === 1 && referenceItem !== undefined;

  const isReferenceNotUnique = !isReferenceUnique;
  if (isReferenceNotUnique) {
    throw new Error("Receipted Aider read reference changed after installation.");
  }

  if (ownership.previouslyPresent) {
    return textEncoder.encode(configYaml);
  }

  const installedReferenceLine = configYaml.slice(referenceItem.start, referenceItem.end);
  const expectedReferenceLine = `${document.itemPrefix}${ownership.reference}${lineEnding(configYaml)}`;
  if (installedReferenceLine !== expectedReferenceLine) {
    throw new Error("Receipted Aider reference line changed after installation.");
  }

  const isInsertedKeyOnly = !ownership.keyPreviouslyPresent && document.items.length === 1;
  if (isInsertedKeyOnly) {
    return removeInsertedYamlKey({ source: configYaml, document, ownership });
  }

  return textEncoder.encode(`${configYaml.slice(0, referenceItem.start)}${configYaml.slice(referenceItem.end)}`);
};
