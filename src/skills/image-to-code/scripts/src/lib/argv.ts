export type ArgValue = string | boolean | string[];

export function parseArgs(argv: string[], options?: { repeat?: string[] }): Record<string, ArgValue> {
  const repeat = new Set(options?.repeat || []);
  const args: Record<string, ArgValue> = {};
  for (const key of repeat) args[key] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      if (repeat.has(key)) (args[key] as string[]).push(next);
      else args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function argString(args: Record<string, ArgValue>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

export function argBool(args: Record<string, ArgValue>, key: string): boolean {
  return args[key] === true;
}
