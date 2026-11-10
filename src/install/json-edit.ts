import { findNodeAtLocation, type Node, parseTree } from "jsonc-parser";

import { hashBytes } from "./file-bytes.js";
import { createInstallError } from "./install-request.js";

const stringEncoder = new TextEncoder();
const SEPARATOR_ERROR_MESSAGE = "settings.json property separators could not be preserved safely.";

export const encodeDocument = (field: unknown): string => JSON.stringify(field);

// Receipts record owned JSON values by the hash of their compact encoding.
export const hashDocumentField = (field: unknown): string => hashBytes(stringEncoder.encode(encodeDocument(field)));

export const readDocumentPropertyName = (property: Node): string | null => {
  const key = property.children?.[0];
  const isKeyString = typeof key?.value === "string";

  return isKeyString ? key.value : null;
};

const listObjectProperties = (node: Node): ReadonlyArray<Node> => node.children || [];

const readCommaBetween = (details: { source: string; start: number; end: number }): number | null => {
  const offset = details.source.indexOf(",", details.start);
  const isCommaInside = offset >= details.start && offset < details.end;

  return isCommaInside ? offset : null;
};

const requireCommaBetween = (details: { source: string; start: number; end: number }): number => {
  const comma = readCommaBetween(details);

  const isCommaMissing = comma == null;
  if (isCommaMissing) {
    throw createInstallError(SEPARATOR_ERROR_MESSAGE);
  }

  return comma;
};

const readSpliceOrigin = (details: { source: string; start: number; end: number; text?: string }): string =>
  `${details.source.slice(0, details.start)}${details.text ?? ""}${details.source.slice(details.end)}`;

const removeDocumentProperty = (details: { source: string; parent: Node; property: Node }): string => {
  const properties = listObjectProperties(details.parent);
  const index = properties.indexOf(details.property);
  const previous = properties[index - 1];
  const next = properties[index + 1];
  const propertyEnd = details.property.offset + details.property.length;

  const hasNext = next != null;
  if (hasNext) {
    const comma = requireCommaBetween({ source: details.source, start: propertyEnd, end: next.offset });

    return readSpliceOrigin({ source: details.source, start: details.property.offset, end: comma + 1 });
  }

  const hasPrevious = previous != null;
  if (hasPrevious) {
    const comma = requireCommaBetween({
      source: details.source,
      start: previous.offset + previous.length,
      end: details.property.offset,
    });

    return readSpliceOrigin({ source: details.source, start: comma, end: propertyEnd });
  }

  return readSpliceOrigin({ source: details.source, start: details.property.offset, end: propertyEnd });
};

const findProperty = (details: { source: string; path: ReadonlyArray<string> }) => {
  const root = parseTree(details.source);
  const key = details.path.at(-1);

  const isRootMissing = root == null;
  const parent = isRootMissing ? undefined : findNodeAtLocation(root, details.path.slice(0, -1));

  const isObjectLocated = parent?.type === "object";

  const isPathUnlocated = key == null || !isObjectLocated;
  if (isPathUnlocated) {
    return null;
  }

  return {
    key,
    parent,
    property: listObjectProperties(parent).find((candidate) => readDocumentPropertyName(candidate) === key),
  };
};

const replaceDocumentPropertyField = (details: {
  source: string;
  key: string;
  property: Node;
  value: unknown;
}): string => {
  const currentField = details.property.children?.[1];

  const isCurrentFieldMissing = currentField == null;
  if (isCurrentFieldMissing) {
    throw createInstallError(`settings.json property ${details.key} has no value.`);
  }

  return readSpliceOrigin({
    source: details.source,
    start: currentField.offset,
    end: currentField.offset + currentField.length,
    text: encodeDocument(details.value),
  });
};

// A new property copies the key/value spacing and indentation of the last existing one.
const addDocumentProperty = (details: { source: string; key: string; parent: Node; value: unknown }): string => {
  const previous = listObjectProperties(details.parent).at(-1);
  const previousKey = previous?.children?.[0];
  const previousField = previous?.children?.[1];
  const hasKeyFieldSpacing = previousKey != null && previousField != null;
  const keyFieldSeparator = hasKeyFieldSpacing
    ? details.source.slice(previousKey.offset + previousKey.length, previousField.offset)
    : ":";
  const encodedProperty = `${JSON.stringify(details.key)}${keyFieldSeparator}${encodeDocument(details.value)}`;

  const isFirstProperty = previous == null;
  if (isFirstProperty) {
    const opening = details.parent.offset + 1;

    return readSpliceOrigin({ source: details.source, start: opening, end: opening, text: encodedProperty });
  }

  const offset = previous.offset + previous.length;
  const closingWhitespace = details.source.slice(offset, details.parent.offset + details.parent.length - 1);

  return readSpliceOrigin({
    source: details.source,
    start: offset,
    end: offset,
    text: `,${closingWhitespace}${encodedProperty}`,
  });
};

export const editDocumentField = (details: { source: string; path: ReadonlyArray<string>; value: unknown }): string => {
  const located = findProperty(details);

  const isPropertyLocationMissing = located == null;
  if (isPropertyLocationMissing) {
    throw createInstallError(`settings.json path /${details.path.join("/")} is not an editable object property.`);
  }

  const { key, parent, property } = located;
  const isPropertyPresent = property != null;
  const isFieldRemoval = details.value === undefined;

  const isPropertyRemoval = isPropertyPresent && isFieldRemoval;
  if (isPropertyRemoval) {
    return removeDocumentProperty({ source: details.source, parent, property });
  }

  if (isPropertyPresent) {
    return replaceDocumentPropertyField({ source: details.source, key, property, value: details.value });
  }

  if (isFieldRemoval) {
    return details.source;
  }

  return addDocumentProperty({ source: details.source, key, parent, value: details.value });
};

const findArray = (details: { source: string; path: ReadonlyArray<string> }): Node => {
  const root = parseTree(details.source);

  const isRootMissing = root == null;
  const array = isRootMissing ? undefined : findNodeAtLocation(root, [...details.path]);

  const isNotArrayLocated = array?.type !== "array";
  if (isNotArrayLocated) {
    throw createInstallError(`settings.json path /${details.path.join("/")} is not an array.`);
  }

  return array;
};

// A new item copies the spacing in front of the last item, so removing it again restores the exact bytes.
export const appendDocumentArrayElement = (details: {
  source: string;
  path: ReadonlyArray<string>;
  value: unknown;
}): string => {
  const array = findArray(details);
  const elements = array.children || [];
  const last = elements.at(-1);
  const encodedElement = encodeDocument(details.value);

  const isArrayEmpty = last == null;
  if (isArrayEmpty) {
    const opening = array.offset + 1;

    return readSpliceOrigin({ source: details.source, start: opening, end: opening, text: encodedElement });
  }

  const beforeLast = elements.at(-2);
  const isOnlyElement = beforeLast == null;
  const separatorComma = isOnlyElement
    ? array.offset
    : requireCommaBetween({ source: details.source, start: beforeLast.offset + beforeLast.length, end: last.offset });
  const leadingWhitespace = details.source.slice(separatorComma + 1, last.offset);
  const lastEnd = last.offset + last.length;

  return readSpliceOrigin({
    source: details.source,
    start: lastEnd,
    end: lastEnd,
    text: `,${leadingWhitespace}${encodedElement}`,
  });
};

export const removeDocumentArrayElement = (details: {
  source: string;
  path: ReadonlyArray<string>;
  index: number;
}): string => {
  const array = findArray(details);
  const elements = array.children || [];

  const element = elements[details.index];

  const isElementMissing = element == null;
  if (isElementMissing) {
    throw createInstallError(`settings.json array /${details.path.join("/")} has no item ${details.index}.`);
  }

  const previous = elements[details.index - 1];
  const next = elements[details.index + 1];
  const elementEnd = element.offset + element.length;
  const hasPrevious = previous != null;
  const previousComma = hasPrevious
    ? requireCommaBetween({ source: details.source, start: previous.offset + previous.length, end: element.offset })
    : null;
  const start = previousComma ?? element.offset;
  const isFirstElementBeforeNext = previous == null && next != null;
  const end = isFirstElementBeforeNext ? next.offset : elementEnd;

  return readSpliceOrigin({ source: details.source, start, end });
};
