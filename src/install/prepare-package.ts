// Prepare the package that install, update, and doctor read: compiled hook code from dist/src/hooks/<sourceDirectory>/
// goes to dist/prepared/hooks/<sourceDirectory>/, and each catalog skill allowlist to dist/prepared/skills/<id>/.

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { featureCatalog } from "../catalog/feature-catalog.js";
import { isNotFound } from "./file-bytes.js";
import { type PreparedPackage, readErrorMessage } from "./install-request.js";
import { findPackageRoot, readPackageVersion } from "./package-root.js";

const createPreparePackageError = (issue: string, cause?: unknown): Error =>
  new Error(`Cannot prepare agent-setup package: ${issue}`, { cause });

export const isPathPresent = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);

    return true;
  } catch (statError) {
    const isPathMissing = isNotFound(statError);
    if (!isPathMissing) {
      throw statError;
    }

    return false;
  }
};

const copyFile = async (input: { source: string; destination: string }): Promise<void> => {
  await mkdir(path.dirname(input.destination), { recursive: true });
  const sourceBytes = await readFile(input.source);
  await writeFile(input.destination, sourceBytes);
};

// Never copy install junk even when a catalog path is a directory allowlist.
const SKIPPED_TREE_NAMES = new Set(["node_modules", ".playwright", "out", ".git", ".DS_Store"]);

const copyTree = async (input: { source: string; destination: string }): Promise<void> => {
  const isSourcePresent = await isPathPresent(input.source);
  if (!isSourcePresent) {
    return;
  }

  const sourceStat = await stat(input.source);
  const isSourceFile = sourceStat.isFile();
  if (isSourceFile) {
    await copyFile(input);

    return;
  }

  const isSourceDirectory = sourceStat.isDirectory();
  if (!isSourceDirectory) {
    return;
  }

  await mkdir(input.destination, { recursive: true });
  const entryNames = await readdir(input.source);
  for (const entryName of entryNames) {
    const isSkippedEntry = SKIPPED_TREE_NAMES.has(entryName);
    if (!isSkippedEntry) {
      await copyTree({
        source: path.join(input.source, entryName),
        destination: path.join(input.destination, entryName),
      });
    }
  }
};

// The shared hook lib is copied into each feature's lib/, so tsc's src/hooks/lib specifier becomes a
// sibling of lib/ for hooks, watchers, and commands, and a same-folder import for lib files themselves.
// e.g. "../../lib/hook-config.js" from src/hooks/<feature>/hooks/ or src/hooks/<feature>/lib/
const SHARED_HOOK_LIB_IMPORT = "../../lib/";

const RUNTIME_IMPORT_PARTS: ReadonlyArray<{ readonly part: string; readonly runtimeImport: string }> = [
  { part: "hooks", runtimeImport: "../lib/" },
  { part: "watchers", runtimeImport: "../lib/" },
  { part: "command", runtimeImport: "../lib/" },
  { part: "lib", runtimeImport: "./" },
];

const rewriteSharedLibFile = async (input: { preparedPath: string; runtimeImport: string }): Promise<boolean> => {
  const source = await readFile(input.preparedPath, "utf8");
  const usesSharedRuntime = source.includes(SHARED_HOOK_LIB_IMPORT);
  if (usesSharedRuntime) {
    await writeFile(input.preparedPath, source.replaceAll(SHARED_HOOK_LIB_IMPORT, input.runtimeImport));
  }

  return usesSharedRuntime;
};

const rewriteSharedLibImports = async (input: { partRoot: string; runtimeImport: string }): Promise<boolean> => {
  const isPartPresent = await isPathPresent(input.partRoot);
  if (!isPartPresent) {
    return false;
  }

  const entryNames = await readdir(input.partRoot);
  const preparedFileNames = entryNames.filter((name) => name.endsWith(".js"));
  const sharedRuntimeUsers = await Promise.all(
    preparedFileNames.map((name) =>
      rewriteSharedLibFile({ preparedPath: path.join(input.partRoot, name), runtimeImport: input.runtimeImport }),
    ),
  );

  return sharedRuntimeUsers.some(Boolean);
};

const copyHookFeature = async (input: {
  packageRoot: string;
  preparedRoot: string;
  sourceDirectory: string;
}): Promise<void> => {
  const compiledFeatureRoot = path.join(input.packageRoot, "dist", "src", "hooks", input.sourceDirectory);
  const preparedFeatureRoot = path.join(input.preparedRoot, "hooks", input.sourceDirectory);
  const isFeatureCompiled = await isPathPresent(compiledFeatureRoot);
  if (!isFeatureCompiled) {
    return;
  }

  for (const part of ["hooks", "watchers", "lib", "command"]) {
    await copyTree({
      source: path.join(compiledFeatureRoot, part),
      destination: path.join(preparedFeatureRoot, part),
    });
  }

  const sharedRuntimeUsers = await Promise.all(
    RUNTIME_IMPORT_PARTS.map(({ part, runtimeImport }) =>
      rewriteSharedLibImports({ partRoot: path.join(preparedFeatureRoot, part), runtimeImport }),
    ),
  );
  const isSharedLibNeeded = sharedRuntimeUsers.some(Boolean);
  if (isSharedLibNeeded) {
    await copyTree({
      source: path.join(input.packageRoot, "dist", "src", "hooks", "lib"),
      destination: path.join(preparedFeatureRoot, "lib"),
    });
  }
};

const copySkillFeature = async (input: {
  packageRoot: string;
  preparedRoot: string;
  sourceDirectory: string;
  skillId: string;
  shippedPaths: ReadonlyArray<string>;
}): Promise<void> => {
  const skillSourceRoot = path.join(input.packageRoot, "src", "skills", input.sourceDirectory);
  const isSkillSourcePresent = await isPathPresent(skillSourceRoot);
  if (!isSkillSourcePresent) {
    throw createPreparePackageError(`Authored skill directory missing at ${skillSourceRoot}.`);
  }

  for (const shippedPath of input.shippedPaths) {
    const source = path.join(skillSourceRoot, shippedPath);
    const isShippedPathPresent = await isPathPresent(source);
    if (!isShippedPathPresent) {
      throw createPreparePackageError(`Catalog-shipped path ${shippedPath} is missing under ${skillSourceRoot}.`);
    }

    await copyTree({ source, destination: path.join(input.preparedRoot, "skills", input.skillId, shippedPath) });
  }
};

const findPreparePackageRoot = async (): Promise<string> => {
  try {
    return await findPackageRoot();
  } catch (rootError) {
    throw createPreparePackageError(readErrorMessage(rootError), rootError);
  }
};

const readPreparePackageVersion = async (): Promise<string> => {
  try {
    return await readPackageVersion();
  } catch (versionError) {
    throw createPreparePackageError(readErrorMessage(versionError), versionError);
  }
};

export const preparePackage = async (): Promise<PreparedPackage> => {
  const packageRoot = await findPreparePackageRoot();
  const compiledHooksRoot = path.join(packageRoot, "dist", "src", "hooks");
  const isCompiledHooksPresent = await isPathPresent(compiledHooksRoot);
  if (!isCompiledHooksPresent) {
    throw createPreparePackageError(
      `Compiled hooks missing at ${compiledHooksRoot}. Run \`pnpm build\` before install, update, or doctor.`,
    );
  }

  const version = await readPreparePackageVersion();
  const preparedRoot = path.join(packageRoot, "dist", "prepared");
  await rm(preparedRoot, { recursive: true, force: true });
  await mkdir(path.join(preparedRoot, "hooks"), { recursive: true });
  await mkdir(path.join(preparedRoot, "skills"), { recursive: true });

  for (const feature of featureCatalog) {
    const runtime = feature.runtime;
    const isHookFeature = runtime._tag === "hook";
    if (isHookFeature) {
      await copyHookFeature({ packageRoot, preparedRoot, sourceDirectory: feature.sourceDirectory });
    }

    const installedSkill = feature.installedSkill;
    const isSkillFeature = installedSkill._tag === "skill";
    if (isSkillFeature) {
      await copySkillFeature({
        packageRoot,
        preparedRoot,
        sourceDirectory: feature.sourceDirectory,
        skillId: installedSkill.id,
        shippedPaths: installedSkill.shippedPaths,
      });
    }
  }

  return { root: preparedRoot, version };
};
