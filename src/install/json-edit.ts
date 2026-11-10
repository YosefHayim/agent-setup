/** Byte-preserving edits to one JSON object property or array item, so a user's settings keep their own formatting. */

import { findNodeAtLocation, type Node, parseTree } from "jsonc-parser";

import { hashBytes } from "./file-bytes.js";
import { createInstallError } from "./install-request.js";

const textEncoder = new TextEncoder();
const SEPARATOR_ERROR_MESSAGE = "settings.json property separators could not be preserved safely.";

export const encodeJson = (value: unknown): string => JSON.stringify(value);

// Receipts record owned JSON values by the hash of their compact encoding.
export const hashJsonValue = (value: unknown): string => hashBytes(textEncoder.encode(encodeJson(value)));

export const jsonPropertyName = (property: Node): string | null => {
  const key = property.children?.[0];
  const isKeyText = typeof key?.value === "string";

  return isKeyText ? key.value : null;
};

const objectProperties = (node: Node): ReadonlyArray<Node> => node.children || [];

const commaBetween = (input: { source: string; start: number; end: number }): number | null => {
  const offset = input.source.indexOf(",", input.start);
  const isCommaInside = offset >= input.start && offset < input.end;

  return isCommaInside ? offset : null;
};

const requireCommaBetween = (input: { source: string; start: number; end: number }): number => {
  const comma = commaBetween(input);
  const isCommaMissing = comma == null;
  if (isCommaMissing) {
    throw createInstallError(SEPARATOR_ERROR_MESSAGE);
  }

  return comma;
};

const spliceSource = (input: { source: string; start: number; end: number; text?: string }): string =>
  `${input.source.slice(0, input.start)}${input.text ?? ""}${input.source.slice(input.end)}`;

const removeJsonProperty = (input: { source: string; parent: Node; property: Node }): string => {
  const properties = objectProperties(input.parent);
  const index = properties.indexOf(input.property);
  const previous = properties[index - 1];
  const next = properties[index + 1];
  const propertyEnd = input.property.offset + input.property.length;

  const hasNext = next != null;
  if (hasNext) {
    const comma = requireCommaBetween({ source: input.source, start: propertyEnd, end: next.offset });

    return spliceSource({ source: input.source, start: input.property.offset, end: comma + 1 });
  }

  const hasPrevious = previous != null;
  if (hasPrevious) {
    const comma = requireCommaBetween({
      source: input.source,
      start: previous.offset + previous.length,
      end: input.property.offset,
    });

    return spliceSource({ source: input.source, start: comma, end: propertyEnd });
  }

  return spliceSource({ source: input.source, start: input.property.offset, end: propertyEnd });
};

const locateProperty = (input: { source: string; path: ReadonlyArray<string> }) => {
  const root = parseTree(input.source);
  const key = input.path.at(-1);
  const parent = root == null ? undefined : findNodeAtLocation(root, input.path.slice(0, -1));
  const isObjectLocated = parent?.type === "object";
  if (key == null || !isObjectLocated) {
    return null;
  }

  return { key, parent, property: objectProperties(parent).find((candidate) => jsonPropertyName(candidate) === key) };
};

const replaceJsonPropertyValue = (input: { source: string; key: string; property: Node; value: unknown }): string => {
  const currentValue = input.property.children?.[1];
  if (currentValue == null) {
    throw createInstallError(`settings.json property ${input.key} has no value.`);
  }

  return spliceSource({
    source: input.source,
    start: currentValue.offset,
    end: currentValue.offset + currentValue.length,
    text: encodeJson(input.value),
  });
};

// A new property copies the key/value spacing and indentation of the last existing one.
const addJsonProperty = (input: { source: string; key: string; parent: Node; value: unknown }): string => {
  const previous = objectProperties(input.parent).at(-1);
  const previousKey = previous?.children?.[0];
  const previousValue = previous?.children?.[1];
  const hasKeyValueSpacing = previousKey != null && previousValue != null;
  const keyValueSeparator = hasKeyValueSpacing
    ? input.source.slice(previousKey.offset + previousKey.length, previousValue.offset)
    : ":";
  const encodedProperty = `${JSON.stringify(input.key)}${keyValueSeparator}${encodeJson(input.value)}`;

  const isFirstProperty = previous == null;
  if (isFirstProperty) {
    const opening = input.parent.offset + 1;

    return spliceSource({ source: input.source, start: opening, end: opening, text: encodedProperty });
  }

  const offset = previous.offset + previous.length;
  const closingWhitespace = input.source.slice(offset, input.parent.offset + input.parent.length - 1);

  return spliceSource({
    source: input.source,
    start: offset,
    end: offset,
    text: `,${closingWhitespace}${encodedProperty}`,
  });
};

export const editJsonValue = (input: { source: string; path: ReadonlyArray<string>; value: unknown }): string => {
  const located = locateProperty(input);
  const isPropertyLocationMissing = located == null;
  if (isPropertyLocationMissing) {
    throw createInstallError(`settings.json path /${input.path.join("/")} is not an editable object property.`);
  }

  const { key, parent, property } = located;
  const isPropertyPresent = property != null;
  const isValueRemoval = input.value === undefined;
  const isPropertyRemoval = isPropertyPresent && isValueRemoval;
  if (isPropertyRemoval) {
    return removeJsonProperty({ source: input.source, parent, property });
  }

  if (isPropertyPresent) {
    return replaceJsonPropertyValue({ source: input.source, key, property, value: input.value });
  }

  if (isValueRemoval) {
    return input.source;
  }

  return addJsonProperty({ source: input.source, key, parent, value: input.value });
};

const locateArray = (input: { source: string; path: ReadonlyArray<string> }): Node => {
  const root = parseTree(input.source);
  const array = root == null ? undefined : findNodeAtLocation(root, [...input.path]);
  const isArrayLocated = array?.type === "array";
  if (!isArrayLocated) {
    throw createInstallError(`settings.json path /${input.path.join("/")} is not an array.`);
  }

  return array;
};

// A new item copies the spacing in front of the last item, so removing it again restores the exact bytes.
export const appendJsonArrayItem = (input: { source: string; path: ReadonlyArray<string>; value: unknown }): string => {
  const array = locateArray(input);
  const items = array.children || [];
  const last = items.at(-1);
  const encodedItem = encodeJson(input.value);

  const isArrayEmpty = last == null;
  if (isArrayEmpty) {
    const opening = array.offset + 1;

    return spliceSource({ source: input.source, start: opening, end: opening, text: encodedItem });
  }

  const beforeLast = items.at(-2);
  const isOnlyItem = beforeLast == null;
  const separatorComma = isOnlyItem
    ? array.offset
    : requireCommaBetween({ source: input.source, start: beforeLast.offset + beforeLast.length, end: last.offset });
  const leadingWhitespace = input.source.slice(separatorComma + 1, last.offset);
  const lastEnd = last.offset + last.length;

  return spliceSource({
    source: input.source,
    start: lastEnd,
    end: lastEnd,
    text: `,${leadingWhitespace}${encodedItem}`,
  });
};

export const removeJsonArrayItem = (input: { source: string; path: ReadonlyArray<string>; index: number }): string => {
  const array = locateArray(input);
  const items = array.children || [];
  const item = items[input.index];
  if (item == null) {
    throw createInstallError(`settings.json array /${input.path.join("/")} has no item ${input.index}.`);
  }

  const previous = items[input.index - 1];
  const next = items[input.index + 1];
  const itemEnd = item.offset + item.length;
  const hasPrevious = previous != null;
  const previousComma = hasPrevious
    ? requireCommaBetween({ source: input.source, start: previous.offset + previous.length, end: item.offset })
    : null;
  const start = previousComma ?? item.offset;
  const isFirstItemBeforeNext = previous == null && next != null;
  const end = isFirstItemBeforeNext ? next.offset : itemEnd;

  return spliceSource({ source: input.source, start, end });
};
