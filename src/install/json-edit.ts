/** Byte-preserving edits to one JSON object property or array item, so a user's settings keep their own formatting. */

import { Either, Schema } from "effect";
import { findNodeAtLocation, type Node, parseTree } from "jsonc-parser";

import { hashBytes } from "./file-bytes.js";
import { InstallError } from "./install-request.js";

const textEncoder = new TextEncoder();
const encodeJson = Schema.encodeSync(Schema.parseJson());

// Receipts record owned JSON values by the hash of their compact encoding.
export const hashJsonValue = (value: unknown): string => hashBytes(textEncoder.encode(encodeJson(value)));

export const jsonPropertyName = (property: Node): string | undefined => {
  const key = property.children?.[0];

  return typeof key?.value === "string" ? key.value : undefined;
};

const objectProperties = (node: Node): ReadonlyArray<Node> => node.children || [];

const commaBetween = (input: { source: string; start: number; end: number }): number | undefined => {
  const offset = input.source.indexOf(",", input.start);

  return offset >= input.start && offset < input.end ? offset : undefined;
};

const spliceSource = (input: { source: string; start: number; end: number; text?: string }): string =>
  input.source.slice(0, input.start) + (input.text || "") + input.source.slice(input.end);

const separatorError = new InstallError({ issue: "settings.json property separators could not be preserved safely." });

const removeJsonProperty = (input: {
  source: string;
  parent: Node;
  property: Node;
}): Either.Either<string, InstallError> => {
  const properties = objectProperties(input.parent);
  const index = properties.indexOf(input.property);
  const previous = properties[index - 1];
  const next = properties[index + 1];
  const propertyEnd = input.property.offset + input.property.length;

  if (next !== undefined) {
    const comma = commaBetween({ source: input.source, start: propertyEnd, end: next.offset });

    return comma === undefined
      ? Either.left(separatorError)
      : Either.right(spliceSource({ source: input.source, start: input.property.offset, end: comma + 1 }));
  }

  if (previous !== undefined) {
    const comma = commaBetween({
      source: input.source,
      start: previous.offset + previous.length,
      end: input.property.offset,
    });

    return comma === undefined
      ? Either.left(separatorError)
      : Either.right(spliceSource({ source: input.source, start: comma, end: propertyEnd }));
  }

  return Either.right(spliceSource({ source: input.source, start: input.property.offset, end: propertyEnd }));
};

const locateProperty = (input: { source: string; path: ReadonlyArray<string> }) => {
  const root = parseTree(input.source);
  const key = input.path.at(-1);
  const parent = root === undefined ? undefined : findNodeAtLocation(root, input.path.slice(0, -1));
  if (key === undefined || parent?.type !== "object") {
    return undefined;
  }

  return { key, parent, property: objectProperties(parent).find((candidate) => jsonPropertyName(candidate) === key) };
};

export const editJsonValue = (input: {
  source: string;
  path: ReadonlyArray<string>;
  value: unknown;
}): Either.Either<string, InstallError> => {
  const located = locateProperty(input);
  if (located === undefined) {
    return Either.left(
      new InstallError({ issue: `settings.json path /${input.path.join("/")} is not an editable object property.` }),
    );
  }

  const { key, parent, property } = located;
  if (property !== undefined) {
    if (input.value === undefined) {
      return removeJsonProperty({ source: input.source, parent, property });
    }

    const currentValue = property.children?.[1];
    if (currentValue === undefined) {
      return Either.left(new InstallError({ issue: `settings.json property ${key} has no value.` }));
    }

    return Either.right(
      spliceSource({
        source: input.source,
        start: currentValue.offset,
        end: currentValue.offset + currentValue.length,
        text: encodeJson(input.value),
      }),
    );
  }

  if (input.value === undefined) {
    return Either.right(input.source);
  }

  // A new property copies the key/value spacing and indentation of the last existing one.
  const previous = objectProperties(parent).at(-1);
  const previousKey = previous?.children?.[0];
  const previousValue = previous?.children?.[1];
  const keyValueSeparator =
    previousKey === undefined || previousValue === undefined
      ? ":"
      : input.source.slice(previousKey.offset + previousKey.length, previousValue.offset);
  const encodedProperty = `${JSON.stringify(key)}${keyValueSeparator}${encodeJson(input.value)}`;
  if (previous === undefined) {
    return Either.right(
      spliceSource({ source: input.source, start: parent.offset + 1, end: parent.offset + 1, text: encodedProperty }),
    );
  }

  const offset = previous.offset + previous.length;
  const closingWhitespace = input.source.slice(offset, parent.offset + parent.length - 1);

  return Either.right(
    spliceSource({ source: input.source, start: offset, end: offset, text: `,${closingWhitespace}${encodedProperty}` }),
  );
};

const locateArray = (input: { source: string; path: ReadonlyArray<string> }): Either.Either<Node, InstallError> => {
  const root = parseTree(input.source);
  const array = root === undefined ? undefined : findNodeAtLocation(root, [...input.path]);

  return array?.type === "array"
    ? Either.right(array)
    : Either.left(new InstallError({ issue: `settings.json path /${input.path.join("/")} is not an array.` }));
};

// A new item copies the spacing in front of the last item, so removing it again restores the exact bytes.
export const appendJsonArrayItem = (input: {
  source: string;
  path: ReadonlyArray<string>;
  value: unknown;
}): Either.Either<string, InstallError> => {
  const located = locateArray(input);

  return Either.flatMap(located, (array) => {
    const items = array.children || [];
    const last = items.at(-1);
    const encodedItem = encodeJson(input.value);
    if (last === undefined) {
      const opening = array.offset + 1;
      const edited = spliceSource({ source: input.source, start: opening, end: opening, text: encodedItem });

      return Either.right(edited);
    }

    const beforeLast = items.at(-2);
    const separatorComma =
      beforeLast === undefined
        ? array.offset
        : commaBetween({ source: input.source, start: beforeLast.offset + beforeLast.length, end: last.offset });
    if (separatorComma === undefined) {
      return Either.left(separatorError);
    }

    const leadingWhitespace = input.source.slice(separatorComma + 1, last.offset);
    const lastEnd = last.offset + last.length;
    const edited = spliceSource({
      source: input.source,
      start: lastEnd,
      end: lastEnd,
      text: `,${leadingWhitespace}${encodedItem}`,
    });

    return Either.right(edited);
  });
};

export const removeJsonArrayItem = (input: {
  source: string;
  path: ReadonlyArray<string>;
  index: number;
}): Either.Either<string, InstallError> => {
  const located = locateArray(input);

  return Either.flatMap(located, (array) => {
    const items = array.children || [];
    const item = items[input.index];
    if (item === undefined) {
      return Either.left(
        new InstallError({ issue: `settings.json array /${input.path.join("/")} has no item ${input.index}.` }),
      );
    }

    const previous = items[input.index - 1];
    const next = items[input.index + 1];
    const itemEnd = item.offset + item.length;
    const previousComma =
      previous === undefined
        ? undefined
        : commaBetween({ source: input.source, start: previous.offset + previous.length, end: item.offset });
    if (previous !== undefined && previousComma === undefined) {
      return Either.left(separatorError);
    }

    const start = previousComma === undefined ? item.offset : previousComma;
    const end = previous === undefined && next !== undefined ? next.offset : itemEnd;
    const edited = spliceSource({ source: input.source, start, end });

    return Either.right(edited);
  });
};
