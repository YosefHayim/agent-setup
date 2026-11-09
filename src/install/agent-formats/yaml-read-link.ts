/** Aider's YAML config: add or remove one instruction path in its `read` block sequence, restoring the exact prior bytes. */

import { Either } from "effect";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import { decodeStrictText, lineEnding } from "../file-bytes.js";
import type { YamlSequenceValueOwnership } from "../ownership.js";

const textEncoder = new TextEncoder();

type YamlReadLink = {
  readonly currentBytes: Uint8Array | undefined;
  readonly configPath: string;
  readonly instructionPath: string;
  readonly previousOwnership: YamlSequenceValueOwnership | undefined;
};

type YamlReadBlock = {
  readonly _tag: "block";
  readonly source: string;
  readonly pairStart: number;
  readonly pairEnd: number;
  readonly insertionIndex: number;
  readonly itemPrefix: string;
  readonly items: ReadonlyArray<{ readonly value: string; readonly start: number; readonly end: number }>;
};

type YamlReadDocument = { readonly _tag: "missing"; readonly source: string } | YamlReadBlock;
type YamlInsertedPrefix = YamlSequenceValueOwnership["insertedPrefix"];

const lineStartAt = (source: string, index: number): number => source.lastIndexOf("\n", index - 1) + 1;

const lineEndAfter = (source: string, index: number): number => {
  const lineFeed = source.indexOf("\n", index);

  return lineFeed < 0 ? source.length : lineFeed + 1;
};

const inspectYamlReadDocument = (source: string): Either.Either<YamlReadDocument, string> => {
  if (source.includes("\t") || /\r(?!\n)/.test(source)) {
    return Either.left("Aider configuration is invalid: use spaces with LF or CRLF line endings.");
  }

  const document = parseDocument(source, { keepSourceTokens: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    return Either.left(`Aider configuration is invalid: ${document.errors.map((error) => error.message).join("; ")}`);
  }

  if (document.contents === null) {
    return Either.right({ _tag: "missing", source });
  }

  if (!isMap(document.contents) || document.contents.flow === true) {
    return Either.left("Aider configuration must be one block mapping.");
  }

  const pair = document.contents.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === "read");
  if (pair === undefined) {
    return Either.right({ _tag: "missing", source });
  }

  if (!isScalar(pair.key) || pair.key.range === undefined || pair.key.range === null) {
    return Either.left("Aider read key has no stable source range.");
  }

  if (pair.value === null) {
    const pairEnd = lineEndAfter(source, pair.key.range[2]);

    return Either.right({
      _tag: "block",
      source,
      pairStart: pair.key.range[0],
      pairEnd,
      insertionIndex: pairEnd,
      itemPrefix: "  - ",
      items: [],
    });
  }

  if (!isSeq(pair.value) || pair.value.flow === true || pair.value.range === undefined || pair.value.range === null) {
    return Either.left("Aider read must be one block sequence of strings.");
  }

  const items = [];
  let itemPrefix: string | undefined;
  for (const item of pair.value.items) {
    if (
      item === null ||
      !isScalar(item) ||
      typeof item.value !== "string" ||
      item.range === undefined ||
      item.range === null ||
      item.anchor !== undefined ||
      item.tag !== undefined
    ) {
      return Either.left("Aider read must contain only direct string values.");
    }

    const start = lineStartAt(source, item.range[0]);
    const prefix = source.slice(start, item.range[0]);
    if (!/^ +-\s+$/.test(prefix) || (itemPrefix !== undefined && itemPrefix !== prefix)) {
      return Either.left("Aider read must use one consistent space-indented block sequence.");
    }

    itemPrefix = prefix;
    items.push({ value: item.value, start, end: item.range[2] });
  }

  const lastItem = items.at(-1);
  const insertionIndex = source.endsWith("\n") || lastItem === undefined ? pair.value.range[2] : lastItem.start;

  return Either.right({
    _tag: "block",
    source,
    pairStart: pair.key.range[0],
    pairEnd: pair.value.range[2],
    insertionIndex,
    itemPrefix: itemPrefix === undefined ? "  - " : itemPrefix,
    items,
  });
};

const yamlReferenceItems = (document: YamlReadDocument, reference: string) =>
  document._tag === "missing" ? [] : document.items.filter((item) => item.value === reference);

const appendYamlReference = (input: {
  document: YamlReadDocument;
  reference: string;
}): {
  source: string;
  insertedPrefix: YamlInsertedPrefix;
  keyPreviouslyPresent: boolean;
} => {
  const ending = lineEnding(input.document.source);
  if (input.document._tag === "missing") {
    const insertedPrefix = input.document.source.length === 0 ? "" : ending;

    return {
      source: `${input.document.source}${insertedPrefix}read:${ending}  - ${input.reference}${ending}`,
      insertedPrefix,
      keyPreviouslyPresent: false,
    };
  }

  if (yamlReferenceItems(input.document, input.reference).length > 0) {
    return { source: input.document.source, insertedPrefix: "", keyPreviouslyPresent: true };
  }

  const referenceLine = `${input.document.itemPrefix}${input.reference}${ending}`;

  return {
    source: `${input.document.source.slice(0, input.document.insertionIndex)}${referenceLine}${input.document.source.slice(input.document.insertionIndex)}`,
    insertedPrefix: "",
    keyPreviouslyPresent: true,
  };
};

const createYamlOwnership = (input: {
  link: YamlReadLink;
  keyPreviouslyPresent: boolean;
  insertedPrefix: YamlInsertedPrefix;
  previouslyPresent: boolean;
}): YamlSequenceValueOwnership =>
  input.link.previousOwnership || {
    _tag: "yamlSequenceValue",
    filePreviouslyPresent: input.link.currentBytes !== undefined,
    key: "read",
    keyPreviouslyPresent: input.keyPreviouslyPresent,
    insertedPrefix: input.insertedPrefix,
    reference: input.link.instructionPath,
    previouslyPresent: input.previouslyPresent,
  };

export const addYamlRead = (
  link: YamlReadLink,
): Either.Either<{ bytes: Uint8Array; ownership: YamlSequenceValueOwnership }, string> => {
  const current =
    link.currentBytes === undefined ? Either.right("") : decodeStrictText(link.currentBytes, link.configPath);
  if (Either.isLeft(current)) {
    return Either.left(current.left);
  }

  const document = inspectYamlReadDocument(current.right);
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }

  if (
    document.right._tag === "block" &&
    document.right.items.length === 0 &&
    document.right.source.length > 0 &&
    !document.right.source.endsWith("\n")
  ) {
    return Either.left("Aider read key must end its line before a reference can be added.");
  }

  const referenceItems = yamlReferenceItems(document.right, link.instructionPath);
  if (link.previousOwnership !== undefined && referenceItems.length !== 1) {
    return Either.left("Receipted Aider read reference changed after installation.");
  }

  if (referenceItems.length > 1) {
    return Either.left("Aider read contains the managed reference more than once.");
  }

  const desired = appendYamlReference({ document: document.right, reference: link.instructionPath });

  return Either.right({
    bytes: textEncoder.encode(desired.source),
    ownership: createYamlOwnership({
      link,
      keyPreviouslyPresent: desired.keyPreviouslyPresent,
      insertedPrefix: desired.insertedPrefix,
      previouslyPresent: referenceItems.length === 1,
    }),
  });
};

const removeInsertedYamlKey = (input: {
  source: string;
  document: YamlReadBlock;
  ownership: YamlSequenceValueOwnership;
}): Either.Either<Uint8Array, string> => {
  const ending = lineEnding(input.source);
  const expectedPair = `read:${ending}${input.document.itemPrefix}${input.ownership.reference}${ending}`;
  const installedPair = input.source.slice(input.document.pairStart, input.document.pairEnd);
  if (installedPair !== expectedPair) {
    return Either.left("Receipted Aider key pair changed after installation.");
  }

  const prefixStart = input.document.pairStart - input.ownership.insertedPrefix.length;
  if (prefixStart < 0 || input.source.slice(prefixStart, input.document.pairStart) !== input.ownership.insertedPrefix) {
    return Either.left("Receipted Aider key framing changed after installation.");
  }

  const prefix = input.source.slice(0, prefixStart);
  const suffix = input.source.slice(input.document.pairEnd);
  const suffixStartsLineEnding = suffix.startsWith("\n") || suffix.startsWith("\r\n");
  const separator =
    prefix.length > 0 && suffix.length > 0 && !prefix.endsWith("\n") && !suffixStartsLineEnding ? ending : "";

  return Either.right(textEncoder.encode(`${prefix}${separator}${suffix}`));
};

// Empty bytes mean the file held nothing but what the installation added, so the caller may delete it.
export const removeYamlRead = (input: {
  currentBytes: Uint8Array;
  configPath: string;
  ownership: YamlSequenceValueOwnership;
}): Either.Either<Uint8Array, string> => {
  const source = decodeStrictText(input.currentBytes, input.configPath);
  if (Either.isLeft(source)) {
    return Either.left(source.left);
  }

  const document = inspectYamlReadDocument(source.right);
  if (Either.isLeft(document) || document.right._tag === "missing") {
    return Either.left("Receipted Aider read reference changed after installation.");
  }

  const referenceItems = yamlReferenceItems(document.right, input.ownership.reference);
  const referenceItem = referenceItems[0];
  if (referenceItems.length !== 1 || referenceItem === undefined) {
    return Either.left("Receipted Aider read reference changed after installation.");
  }

  if (input.ownership.previouslyPresent) {
    return Either.right(textEncoder.encode(source.right));
  }

  const installedReferenceLine = source.right.slice(referenceItem.start, referenceItem.end);
  const expectedReferenceLine = `${document.right.itemPrefix}${input.ownership.reference}${lineEnding(source.right)}`;
  if (installedReferenceLine !== expectedReferenceLine) {
    return Either.left("Receipted Aider reference line changed after installation.");
  }

  if (!input.ownership.keyPreviouslyPresent && document.right.items.length === 1) {
    return removeInsertedYamlKey({ source: source.right, document: document.right, ownership: input.ownership });
  }

  return Either.right(
    textEncoder.encode(`${source.right.slice(0, referenceItem.start)}${source.right.slice(referenceItem.end)}`),
  );
};
