const FLAG_PREFIX = "--";
export type ArgField = string | boolean | string[];

export const parseArgumentList = (argv: string[], settings?: { repeat?: string[] }): Record<string, ArgField> => {
  const repeat = new Set(settings?.repeat || []);
  const argumentList: Record<string, ArgField> = {};
  for (const key of repeat) argumentList[key] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    const isNotFlagToken = !token.startsWith(FLAG_PREFIX);
    if (isNotFlagToken) continue;

    const flagNameStartIndex = 2;

    const key = token.slice(flagNameStartIndex);

    const next = argv[i + 1];

    const isNextTokenArgument = next != null && !next.startsWith(FLAG_PREFIX);
    if (isNextTokenArgument) {
      const isRepeatedFlag = repeat.has(key);
      if (isRepeatedFlag) (argumentList[key] as string[]).push(next);
      else argumentList[key] = next;

      i++;
    } else {
      argumentList[key] = true;
    }
  }
  return argumentList;
};

export const readStringArgument = (argumentList: Record<string, ArgField>, key: string): string | null => {
  const flagArgument = argumentList[key];

  const isStringArgument = typeof flagArgument === "string";
  return isStringArgument ? flagArgument : null;
};

export const readBooleanArgument = (argumentList: Record<string, ArgField>, key: string): boolean => {
  return argumentList[key] === true;
};
