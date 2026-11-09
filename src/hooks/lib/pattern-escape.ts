export const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
