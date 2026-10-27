import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCodeStyle } from "./checkCodeStyle.js";

const repositories: Array<string> = [];

const repositoryWith = (files: Readonly<Record<string, string>>): string => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "agent-setup-style-"));
  repositories.push(repositoryRoot);
  Object.entries(files).forEach(([path, source]) => {
    mkdirSync(dirname(join(repositoryRoot, path)), { recursive: true });
    writeFileSync(join(repositoryRoot, path), source);
  });
  return repositoryRoot;
};

// "file:line ruleId" keeps each expectation on one line.
const findings = (files: Readonly<Record<string, string>>): ReadonlyArray<string> =>
  checkCodeStyle(repositoryWith(files)).map((violation) => `${violation.file}:${violation.line} ${violation.ruleId}`);

afterEach(() => {
  repositories.splice(0).forEach((repositoryRoot) => {
    rmSync(repositoryRoot, { recursive: true, force: true });
  });
});

const EXAMPLE = "src/install/example.ts";

type SingleFileCase = { name: string; source: string; path?: string };

const REJECTED: ReadonlyArray<SingleFileCase & { ruleId: string; line?: number }> = [
  { name: "a function declaration", source: "\nexport function load() {}\n", ruleId: "function.arrow-only", line: 2 },
  { name: "a function expression", source: "export const load = function () {};\n", ruleId: "function.arrow-only" },
  {
    name: "a named function expression",
    source: "export const load = function named() {};\n",
    ruleId: "function.arrow-only",
  },
  { name: "an object method", source: "export const catalog = { load() {} };\n", ruleId: "function.arrow-only" },
  {
    name: "an indirect generator",
    source: "const operation = function* () {};\nexport const install = Effect.gen(operation);\n",
    ruleId: "function.effect-generator",
  },
  {
    name: "a named Effect.gen generator",
    source: "\nexport const install = Effect.gen(function* installWorkflow() {});\n",
    ruleId: "function.effect-generator",
    line: 2,
  },
  {
    name: "a generator passed to another gen",
    source: "export const install = Other.gen(function* () {});\n",
    ruleId: "function.effect-generator",
  },
  { name: "a plain class", source: "export class InstallError {}\n", ruleId: "class.tagged-error-only" },
  {
    name: "a class extending another TaggedError",
    source: 'export class InstallError extends Other.TaggedError<InstallError>()("InstallError", {}) {}\n',
    ruleId: "class.tagged-error-only",
  },
  {
    name: "a class extending a similarly named Schema member",
    source: 'export class InstallError extends Schema.TaggedErrorAlias<InstallError>()("InstallError", {}) {}\n',
    ruleId: "class.tagged-error-only",
  },
  { name: "an as expression", source: "export const decoded = input as string;\n", ruleId: "type.no-assertion" },
  {
    name: "an angle-bracket assertion",
    source: "export const decoded = <string>input;\n",
    ruleId: "type.no-assertion",
  },
  {
    name: "a non-indexed non-null assertion",
    source: "export const required = value!;\n",
    ruleId: "type.no-assertion",
  },
  {
    name: "indexed non-null access without a proof comment",
    source: "export const pick = (items: string[], index: number) => {\n  return items[index]!;\n};\n",
    ruleId: "comment.index-proof",
    line: 2,
  },
  {
    name: "three positional parameters",
    source: "export const join = (first: string, second: string, third: string) => first + second + third;\n",
    ruleId: "function.input-shape",
  },
  {
    name: "a rest parameter",
    source: 'export const join = (...parts: string[]) => parts.join("");\n',
    ruleId: "function.input-shape",
  },
  {
    name: "a positional boolean",
    source: 'export const render = (value: string, enabled: boolean) => (enabled ? value : "");\n',
    ruleId: "function.input-shape",
  },
  {
    name: "a positional boolean default",
    source: 'export const render = (value: string, enabled = false) => (enabled ? value : "");\n',
    ruleId: "function.input-shape",
  },
  { name: "an interface", source: "export interface Config { debug: boolean }\n", ruleId: "type.no-interface" },
  { name: "an enum", source: "export enum Scope { Global, Project }\n", ruleId: "type.no-enum" },
  {
    name: "conditional and infer type machinery",
    source: "export type ElementOf<Value> = Value extends ReadonlyArray<infer Item> ? Item : Value;\n",
    ruleId: "type.no-conditional",
  },
  { name: "unsafe any", source: "export const decode = (input: any) => input;\n", ruleId: "type.no-unsafe-any" },
  ...[
    "// @ts-ignore",
    "// @ts-expect-error",
    "// @ts-nocheck",
    "// biome-ignore lint/suspicious/noExplicitAny: fixture",
    "// prettier-ignore",
    "// eslint-disable-next-line no-console",
    "/* c8 ignore next */",
    "/* istanbul ignore next */",
    "/* v8 ignore next */",
  ].map((directive) => ({
    name: `the suppression ${directive}`,
    source: `${directive}\nexport const value: string = input;\n`,
    ruleId: "type.no-suppression",
  })),
  {
    name: "adjacent arrow functions without a blank line",
    source: "export const first = () => 1;\nexport const second = () => 2;\n",
    ruleId: "function.blank-line",
    line: 2,
  },
  {
    name: "a third nesting level",
    source: "export const choose = () => {\n  if (a) {\n    if (b) {\n      if (c) { return 1; }\n    }\n  }\n};\n",
    ruleId: "function.nesting",
    line: 4,
  },
  {
    name: "an exported handwritten object type",
    path: "src/catalog/featureCatalog.ts",
    source: "export type FeatureDefinition = { id: string };\n",
    ruleId: "type.schema-owned-runtime",
  },
  {
    name: "a handwritten object type in an application folder named runtime",
    path: "src/install/runtime/runtimeState.ts",
    source: "export type RuntimeState = { sessionId: string };\n",
    ruleId: "type.schema-owned-runtime",
  },
  {
    name: "an exported object type mixing data and functions",
    path: "src/doctor/healthStore.ts",
    source: "export type HealthStore = { filePath: string; readHealth: () => Effect.Effect<void> };\n",
    ruleId: "type.schema-owned-runtime",
  },
  ...[
    'export { featureCatalog } from "./featureCatalog.js";\n',
    'export * as catalog from "./featureCatalog.js";\n',
    'export * from "./catalog/index.js";\n',
  ].map((source) => ({
    name: `a re-export module: ${source.trim()}`,
    path: "src/catalog/catalogExports.ts",
    source,
    ruleId: "module.no-passive-barrel",
  })),
  {
    name: "a generic token in a compound name",
    source: "export const planResult = {};\n",
    ruleId: "name.domain-specific",
  },
  {
    name: "a generic token in a skill script",
    path: "src/skills/exampleSkill/scripts/inspect.mjs",
    source: "export const rawResult = readReceipt();\n",
    ruleId: "name.domain-specific",
  },
  {
    name: "a generic bucket filename",
    path: "src/install/helpers.ts",
    source: "export const value = 1;\n",
    ruleId: "path.no-generic-bucket",
  },
  {
    name: "a kebab-case directory",
    path: "src/bad-directory/example.ts",
    source: "export const value = 1;\n",
    ruleId: "path.source-directory-case",
  },
  {
    name: "a retired layer",
    path: "src/core/example.ts",
    source: "export const value = 1;\n",
    ruleId: "path.capability-layout",
  },
  {
    name: "hook code inside a skill",
    path: "src/skills/exampleSkill/hooks/guard.ts",
    source: "export const guard = () => 1;\n",
    ruleId: "path.payload-runtime-split",
  },
  {
    name: "mutation of an input property",
    source: 'export const normalize = (request: Request) => {\n  request.scope = "global";\n  return request;\n};\n',
    ruleId: "mutation.no-input",
    line: 2,
  },
  ...[
    'export const append = (request: { items: string[] }) => { request.items.push("next"); };\n',
    "export const increment = (request: { count: number }) => { request.count++; };\n",
    "export const clear = (request: { cache?: string }) => { delete request.cache; };\n",
    'export const append = ({ items }: { items: string[] }) => { items.push("next"); };\n',
    'export const append = (request: { items: string[] }) => Effect.sync(() => request.items.push("next"));\n',
  ].map((source) => ({ name: `input mutation in ${source.trim()}`, source, ruleId: "mutation.no-input" })),
  { name: "Promise.all", source: "export const apply = () => Promise.all(tasks);\n", ruleId: "effect.no-promise-all" },
  {
    name: "Effect.run outside src/cli/main.ts",
    source: "export const execution = Effect.runPromise(program);\n",
    ruleId: "effect.runtime-edge",
  },
  { name: "console output", source: 'console.log("installed");\n', ruleId: "presentation.terminal-ui" },
  { name: "?? in application code", source: "export const scope = input ?? fallback;\n", ruleId: "syntax.no-nullish" },
  {
    name: "?? in hook code",
    path: "src/hooks/contextGuard/lib/decide.ts",
    source: 'export const decide = (value?: string) => value ?? "off";\n',
    ruleId: "syntax.no-nullish",
  },
  {
    name: "?? in tooling",
    path: "src/scripts/example.ts",
    source: "export const root = process.argv[2] ?? process.cwd();\n",
    ruleId: "syntax.no-nullish",
  },
  {
    name: "?? in a skill script",
    path: "src/skills/exampleSkill/scripts/inspect.mjs",
    source: "export const scene = clip ?? still;\n",
    ruleId: "syntax.no-nullish",
  },
  {
    name: "?? in a root config file",
    path: "vitest.config.ts",
    source: "export const timeout = override ?? 30_000;\n",
    ruleId: "syntax.no-nullish",
  },
];

const ACCEPTED: ReadonlyArray<SingleFileCase> = [
  { name: "an arrow constant", source: "export const load = () => [];\n" },
  {
    name: "an anonymous generator passed directly to Effect.gen",
    source: "export const install = Effect.gen(function* () { yield* Effect.void; });\n",
  },
  {
    name: "a class extending Schema.TaggedError",
    source: 'export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {}) {}\n',
  },
  { name: "a type alias", source: "export type FeatureId = string;\n" },
  {
    name: "an exported object type holding only functions",
    path: "src/doctor/healthStore.ts",
    source: "export type HealthStore = { readHealth: () => Effect.Effect<void>; writeHealth(record: string): void };\n",
  },
  { name: "assertion-looking string content", source: 'export const copy = "input as string";\n' },
  { name: "a satisfies expression", source: "export const values = { id: 1 } satisfies Record<string, unknown>;\n" },
  {
    name: "a natural pair and a named request",
    source:
      "export const pair = (left: string, right: string) => left + right;\n\nexport const install = (request: InstallRequest) => request.scope;\n",
  },
  {
    name: "explicit loops without intent comments",
    source:
      "export const scan = () => {\n  for (;;) { break; }\n  for (const item of items) { use(item); }\n  for (const key in record) { use(key); }\n  while (ready) { use(); }\n  do { use(); } while (ready);\n};\n",
  },
  {
    name: "indexed non-null access with a proof comment",
    source:
      "export const pick = (items: string[], index: number) => {\n  // Bounds were checked before this lookup.\n  return items[index]!;\n};\n",
  },
  {
    name: "an interface in a declaration file",
    path: "src/types/environment.d.ts",
    source: "declare global { interface ProcessEnv { AGENT_SETUP_REHOME_STATE_DIR?: string } }\nexport {};\n",
  },
  { name: "directive-looking string content", source: 'export const copy = "@ts-ignore";\n' },
  {
    name: "arrow functions separated by a blank line",
    source: "export const first = () => 1;\n\nexport const second = () => 2;\n",
  },
  {
    name: "two nesting levels",
    source: "export const choose = () => {\n  if (a) {\n    if (b) { return 1; }\n  }\n};\n",
  },
  {
    name: "a Schema-derived type",
    path: "src/catalog/featureCatalog.ts",
    source: "export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;\n",
  },
  ...[
    "src/hooks/lib/hookInput.ts",
    "src/hooks/contextGuard/hooks/hookInput.ts",
    "src/hooks/contextGuard/lib/runtimeState.ts",
  ].map((path) => ({
    name: `a structural type in hook code at ${path}`,
    path,
    source: "export type HookInput = { sessionId: string };\n",
  })),
  {
    name: "a module that owns behavior",
    path: "src/catalog/catalogSelection.ts",
    source: "export const featureCatalog = [];\n",
  },
  { name: "domain-specific names", source: "export const installPlan = {};\nexport const metadata = {};\n" },
  {
    name: "mutation of a locally owned collection",
    source:
      'export const collect = () => {\n  const items: string[] = [];\n  items.push("value");\n  return items;\n};\n',
  },
  {
    name: "a local collection that shadows an input",
    source:
      'export const collect = (items: string[]) => Effect.sync(() => {\n  const items: string[] = [];\n  items.push("value");\n  return items;\n});\n',
  },
  {
    name: "a loop binding that shadows an input",
    source:
      'export const collect = (items: string[]) => {\n  for (const items of batches) {\n    items.push("value");\n  }\n};\n',
  },
  {
    name: "a catch binding that shadows an input",
    source:
      'export const handle = (error: Error) => {\n  try {\n    run();\n  } catch (error) {\n    error.name = "handled";\n  }\n};\n',
  },
  {
    name: "reduce, which is left to judgment",
    source:
      "export const collect = (items: string[]) => items.reduce((collectedItems, item) => [...collectedItems, item], []);\n",
  },
  {
    name: "Effect.run at src/cli/main.ts",
    path: "src/cli/main.ts",
    source: "export const execution = Effect.runPromise(program);\n",
  },
  {
    name: "console, Promise.all, and Effect.run in tooling",
    path: "src/scripts/example.ts",
    source: 'console.log("checking");\nexport const executions = Promise.all(tasks);\nEffect.runPromise(program);\n',
  },
  {
    name: "?? in the one excepted render script",
    path: "src/skills/makePromoVideo/scripts/assembleCut.mjs",
    source: "export const scene = clip ?? still;\n",
  },
  { name: "a string that contains ??", source: 'export const unknownTty = "??";\n' },
];

describe("checkCodeStyle", () => {
  it.each(REJECTED)("reports $ruleId for $name", ({ path = EXAMPLE, source, ruleId, line = 1 }) => {
    expect(findings({ [path]: source })).toEqual([`${path}:${line} ${ruleId}`]);
  });

  it.each(ACCEPTED)("accepts $name", ({ path = EXAMPLE, source }) => {
    expect(findings({ [path]: source })).toEqual([]);
  });

  it("reports an index-named barrel for both ownership rules", () => {
    expect(findings({ "src/catalog/index.ts": 'export * from "./featureCatalog.js";\n' })).toEqual([
      "src/catalog/index.ts:1 module.no-passive-barrel",
      "src/catalog/index.ts:1 path.no-generic-bucket",
    ]);
  });

  it("reports a barrel chain hidden behind a regular module name", () => {
    expect(
      findings({
        "src/index.ts": 'export * from "./catalog.js";\n',
        "src/catalog.ts": 'export * from "./catalog/featureCatalog.js";\n',
        "src/catalog/featureCatalog.ts": "export const featureCatalog = [];\n",
      }),
    ).toEqual([
      "src/catalog.ts:1 module.no-passive-barrel",
      "src/index.ts:1 module.no-passive-barrel",
      "src/index.ts:1 path.no-generic-bucket",
    ]);
  });

  it("skips dependencies, build output, and agent folders", () => {
    const forbidden = "export function forbidden() {}\n";

    expect(
      findings({
        "node_modules/package/index.ts": forbidden,
        "dist/src/generated.ts": forbidden,
        ".agents/skills/generated.ts": forbidden,
        ".cursor/rules/generated.ts": forbidden,
        ".devin/instructions/generated.ts": forbidden,
      }),
    ).toEqual([]);
  });
});

describe("hook import graph", () => {
  const HOOK = "src/hooks/contextGuard/hooks/contextGuard.ts";

  it("allows node modules, the shared hook library, and the hook's own feature folder", () => {
    expect(
      findings({
        "src/hooks/lib/readConfig.ts": 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n',
        [HOOK]:
          'import { read } from "../../lib/readConfig.js";\nimport { decide } from "../lib/decide.js";\nexport const run = () => decide(read);\n',
        "src/hooks/contextGuard/lib/decide.ts": "export const decide = (value: unknown) => value;\n",
      }),
    ).toEqual([]);
  });

  it.each<{ name: string; files: Record<string, string> }>([
    {
      name: "a third-party import",
      files: { [HOOK]: 'import { Effect } from "effect";\nexport const run = Effect.void;\n' },
    },
    {
      name: "a type-only application import",
      files: {
        "src/install/plan.ts": "export type Plan = string;\n",
        [HOOK]: 'import type { Plan } from "../../../install/plan.js";\nexport const run = () => undefined;\n',
      },
    },
    {
      name: "an application value import",
      files: {
        "src/install/plan.ts": "export const installPlan = {};\n",
        [HOOK]: 'import { installPlan } from "../../../install/plan.js";\nexport const invoke = () => installPlan;\n',
      },
    },
    { name: "a dynamic third-party import", files: { [HOOK]: 'export const run = () => import("effect");\n' } },
  ])("rejects $name", ({ files }) => {
    expect(findings(files)).toEqual([`${HOOK}:1 import.hook-runtime`]);
  });

  it("reports a third-party import in a hook library at its own file", () => {
    expect(
      findings({
        [HOOK]: 'import { run } from "../lib/bridge.js";\nexport const invoke = () => run;\n',
        "src/hooks/contextGuard/lib/bridge.ts": 'import { Effect } from "effect";\nexport const run = Effect.void;\n',
      }),
    ).toEqual(["src/hooks/contextGuard/lib/bridge.ts:1 import.hook-runtime"]);
  });

  it("rejects an application import of hook code outside a command module", () => {
    expect(
      findings({
        "src/hooks/lib/readConfig.ts": "export const readConfig = () => ({});\n",
        "src/install/runtimeBridge.ts":
          'import { readConfig } from "../hooks/lib/readConfig.js";\nexport const readManagedConfig = () => readConfig();\n',
        "src/install/install.ts":
          'import { readManagedConfig } from "./runtimeBridge.js";\nexport const install = () => readManagedConfig();\n',
      }),
    ).toEqual(["src/install/runtimeBridge.ts:1 import.application-boundary"]);
  });

  it("allows an application import of a hook command module", () => {
    expect(
      findings({
        "src/hooks/duplicateCodeGuard/command/checkDuplicates.ts": "export const checkDuplicates = () => [];\n",
        "src/cli/duplicatesCommand.ts":
          'import { checkDuplicates } from "../hooks/duplicateCodeGuard/command/checkDuplicates.js";\nexport const run = checkDuplicates;\n',
      }),
    ).toEqual([]);
  });
});
