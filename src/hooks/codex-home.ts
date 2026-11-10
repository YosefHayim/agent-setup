import path from "node:path";
import { readCodexHomeFolder } from "./environment.js";

export const readCodexHome = (homeRoot: string): string => {
  const configuredFolder = readCodexHomeFolder();
  return configuredFolder ?? path.join(homeRoot, ".codex");
};
