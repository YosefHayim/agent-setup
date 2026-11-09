import { visit } from "jsonc-parser";

export const findDuplicateJsonKey = (json: string): string | undefined => {
  const objectProperties: Array<Set<string>> = [];
  let duplicate: string | undefined;

  visit(
    json,
    {
      onObjectBegin: () => {
        objectProperties.push(new Set());
      },
      onObjectProperty: (property) => {
        const properties = objectProperties.at(-1);
        if (duplicate === undefined && properties?.has(property)) {
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
