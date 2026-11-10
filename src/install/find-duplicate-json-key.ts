import { visit } from "jsonc-parser";

export const findDuplicateJsonKey = (document: string): string | undefined => {
  const objectProperties: Array<Set<string>> = [];
  let duplicate: string | undefined;

  visit(
    document,
    {
      onObjectBegin: () => {
        objectProperties.push(new Set());
      },
      onObjectProperty: (property) => {
        const properties = objectProperties.at(-1);
        const isDuplicateKeyFound = duplicate == null && properties?.has(property);
        if (isDuplicateKeyFound) {
          duplicate = property;
        }

        properties?.add(property);
      },
      onObjectEnd: () => {
        objectProperties.pop();
      },
    },
    {
      allowEmptyContent: false,
      allowTrailingComma: false,
      disallowComments: true,
    },
  );

  return duplicate;
};
