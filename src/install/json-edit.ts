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

const readCommaBetween = (gap: { document: string; start: number; end: number }): number | null => {
  const offset = gap.document.indexOf(",", gap.start);
  const isCommaInside = offset >= gap.start && offset < gap.end;

  return isCommaInside ? offset : null;
};

const requireCommaBetween = (gap: { document: string; start: number; end: number }): number => {
  const comma = readCommaBetween(gap);

  const isCommaMissing = comma == null;
  if (isCommaMissing) {
    throw createInstallError(SEPARATOR_ERROR_MESSAGE);
  }

  return comma;
};

const replaceDocumentRange = (range: { document: string; start: number; end: number; replacement?: string }): string =>
  `${range.document.slice(0, range.start)}${range.replacement ?? ""}${range.document.slice(range.end)}`;

const removeDocumentProperty = (removal: { document: string; parent: Node; property: Node }): string => {
  const properties = listObjectProperties(removal.parent);
  const index = properties.indexOf(removal.property);
  const previous = properties[index - 1];
  const next = properties[index + 1];
  const propertyEnd = removal.property.offset + removal.property.length;

  const hasNext = next != null;
  if (hasNext) {
    const comma = requireCommaBetween({ document: removal.document, start: propertyEnd, end: next.offset });

    return replaceDocumentRange({ document: removal.document, start: removal.property.offset, end: comma + 1 });
  }

  const hasPrevious = previous != null;
  if (hasPrevious) {
    const comma = requireCommaBetween({
      document: removal.document,
      start: previous.offset + previous.length,
      end: removal.property.offset,
    });

    return replaceDocumentRange({ document: removal.document, start: comma, end: propertyEnd });
  }

  return replaceDocumentRange({ document: removal.document, start: removal.property.offset, end: propertyEnd });
};

const findProperty = (location: { document: string; path: ReadonlyArray<string> }) => {
  const root = parseTree(location.document);
  const key = location.path.at(-1);

  const isRootMissing = root == null;
  const parent = isRootMissing ? undefined : findNodeAtLocation(root, location.path.slice(0, -1));

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

const findEditableProperty = (location: { document: string; path: ReadonlyArray<string> }) => {
  const located = findProperty(location);

  const isPropertyLocationMissing = located == null;
  if (isPropertyLocationMissing) {
    throw createInstallError(`settings.json path /${location.path.join("/")} is not an editable object property.`);
  }

  return located;
};

const replaceDocumentPropertyField = (replacement: {
  document: string;
  key: string;
  property: Node;
  newField: unknown;
}): string => {
  const currentField = replacement.property.children?.[1];

  const isCurrentFieldMissing = currentField == null;
  if (isCurrentFieldMissing) {
    throw createInstallError(`settings.json property ${replacement.key} has no value.`);
  }

  return replaceDocumentRange({
    document: replacement.document,
    start: currentField.offset,
    end: currentField.offset + currentField.length,
    replacement: encodeDocument(replacement.newField),
  });
};

// A new property copies the key/value spacing and indentation of the last existing one.
const addDocumentProperty = (addition: { document: string; key: string; parent: Node; newField: unknown }): string => {
  const previous = listObjectProperties(addition.parent).at(-1);
  const previousKey = previous?.children?.[0];
  const previousField = previous?.children?.[1];
  const hasKeyFieldSpacing = previousKey != null && previousField != null;
  const keyFieldSeparator = hasKeyFieldSpacing
    ? addition.document.slice(previousKey.offset + previousKey.length, previousField.offset)
    : ":";
  const encodedProperty = `${JSON.stringify(addition.key)}${keyFieldSeparator}${encodeDocument(addition.newField)}`;

  const isFirstProperty = previous == null;
  if (isFirstProperty) {
    const opening = addition.parent.offset + 1;

    return replaceDocumentRange({
      document: addition.document,
      start: opening,
      end: opening,
      replacement: encodedProperty,
    });
  }

  const offset = previous.offset + previous.length;
  const closingWhitespace = addition.document.slice(offset, addition.parent.offset + addition.parent.length - 1);

  return replaceDocumentRange({
    document: addition.document,
    start: offset,
    end: offset,
    replacement: `,${closingWhitespace}${encodedProperty}`,
  });
};

export const editDocumentField = (edit: {
  document: string;
  path: ReadonlyArray<string>;
  newField: unknown;
}): string => {
  const { key, parent, property } = findEditableProperty(edit);

  const isPropertyPresent = property != null;
  if (isPropertyPresent) {
    return replaceDocumentPropertyField({ document: edit.document, key, property, newField: edit.newField });
  }

  return addDocumentProperty({ document: edit.document, key, parent, newField: edit.newField });
};

// Removes the field at the path; a field that is already absent leaves the document unchanged.
export const removeDocumentField = (removal: { document: string; path: ReadonlyArray<string> }): string => {
  const { parent, property } = findEditableProperty(removal);

  const isPropertyAbsent = property == null;
  if (isPropertyAbsent) {
    return removal.document;
  }

  return removeDocumentProperty({ document: removal.document, parent, property });
};

const findArray = (location: { document: string; path: ReadonlyArray<string> }): Node => {
  const root = parseTree(location.document);

  const isRootMissing = root == null;
  const array = isRootMissing ? undefined : findNodeAtLocation(root, [...location.path]);

  const isNotArrayLocated = array?.type !== "array";
  if (isNotArrayLocated) {
    throw createInstallError(`settings.json path /${location.path.join("/")} is not an array.`);
  }

  return array;
};

// A new item copies the spacing in front of the last item, so removing it again restores the exact bytes.
export const appendDocumentArrayElement = (append: {
  document: string;
  path: ReadonlyArray<string>;
  newElement: unknown;
}): string => {
  const array = findArray(append);
  const elementNodes = array.children || [];
  const lastElementNode = elementNodes.at(-1);
  const encodedElement = encodeDocument(append.newElement);

  const isArrayEmpty = lastElementNode == null;
  if (isArrayEmpty) {
    const opening = array.offset + 1;

    return replaceDocumentRange({
      document: append.document,
      start: opening,
      end: opening,
      replacement: encodedElement,
    });
  }

  const beforeLastElementNode = elementNodes.at(-2);
  const isOnlyElement = beforeLastElementNode == null;
  const separatorComma = isOnlyElement
    ? array.offset
    : requireCommaBetween({
        document: append.document,
        start: beforeLastElementNode.offset + beforeLastElementNode.length,
        end: lastElementNode.offset,
      });
  const leadingWhitespace = append.document.slice(separatorComma + 1, lastElementNode.offset);
  const lastEnd = lastElementNode.offset + lastElementNode.length;

  return replaceDocumentRange({
    document: append.document,
    start: lastEnd,
    end: lastEnd,
    replacement: `,${leadingWhitespace}${encodedElement}`,
  });
};

export const removeDocumentArrayElement = (removal: {
  document: string;
  path: ReadonlyArray<string>;
  index: number;
}): string => {
  const array = findArray(removal);
  const elementNodes = array.children || [];

  const elementNode = elementNodes[removal.index];

  const isElementMissing = elementNode == null;
  if (isElementMissing) {
    throw createInstallError(`settings.json array /${removal.path.join("/")} has no item ${removal.index}.`);
  }

  const previousElementNode = elementNodes[removal.index - 1];
  const nextElementNode = elementNodes[removal.index + 1];
  const elementEnd = elementNode.offset + elementNode.length;
  const hasPrevious = previousElementNode != null;
  const previousComma = hasPrevious
    ? requireCommaBetween({
        document: removal.document,
        start: previousElementNode.offset + previousElementNode.length,
        end: elementNode.offset,
      })
    : null;
  const start = previousComma ?? elementNode.offset;
  const isFirstElementBeforeNext = previousElementNode == null && nextElementNode != null;
  const end = isFirstElementBeforeNext ? nextElementNode.offset : elementEnd;

  return replaceDocumentRange({ document: removal.document, start, end });
};
