import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { globSync } from "glob";
import { describe, expect, it } from "vitest";

import { environmentVariables } from "./environment-variables.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIST_FILES = new Set(["src/config/environment-variables.ts", "src/config/environment-variables.test.ts"]);
// e.g. "AGENT_SETUP_REHOME_STATE_DIR" inside TypeScript, Python, shell, or their docs
const ENVIRONMENT_VARIABLE_NAME = /AGENT_SETUP_[A-Z_]+/g;

const namesBySourceFile = (): ReadonlyMap<string, ReadonlySet<string>> =>
  new Map(
    globSync("src/**/*.{ts,tsx,js,mjs,py,sh,md}", {
      cwd: packageRoot,
      nodir: true,
      ignore: ["**/node_modules/**", "**/dist/**", "src/scripts/dev/**"],
    })
      .filter((file) => !LIST_FILES.has(file))
      .map((file) => [
        file,
        new Set(readFileSync(path.join(packageRoot, file), "utf8").match(ENVIRONMENT_VARIABLE_NAME)),
      ]),
  );

describe("environmentVariables", () => {
  it("lists every AGENT_SETUP_* name that code or docs under src/ use", () => {
    const listed = new Set(environmentVariables.map((variable) => variable.name));
    const unlisted = [...namesBySourceFile()].flatMap(([file, names]) =>
      [...names].filter((name) => !listed.has(name)).map((name) => `${file}: ${name}`),
    );

    expect(unlisted).toEqual([]);
  });

  it("lists only names that some file under src/ still uses", () => {
    const used = new Set([...namesBySourceFile().values()].flatMap((names) => [...names]));

    expect(environmentVariables.map((variable) => variable.name).filter((name) => !used.has(name))).toEqual([]);
  });

  it("keeps each name once", () => {
    const names = environmentVariables.map((variable) => variable.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
