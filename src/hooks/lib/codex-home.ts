import path from "node:path";

export const codexHome = (homeRoot: string): string => process.env.CODEX_HOME || path.join(homeRoot, ".codex");
