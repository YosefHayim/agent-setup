export const escapeForPattern = (literalString: string): string =>
  literalString.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
