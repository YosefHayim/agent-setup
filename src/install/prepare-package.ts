// Prepare the package that install, update, and doctor read: compiled hook code from dist/src/hooks/<sourceDirectory>/
// goes to dist/prepared/hooks/<sourceDirectory>/, and each catalog skill allowlist to dist/prepared/skills/<id>/.

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { featureCatalog } from "#src/catalog/feature-catalog.js";
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

// Source hook code has no lib/ folder. A feature's lib files sit beside its hooks/, watchers/ and command/
// folders, and the shared hook files sit beside the feature folders. So a source import "../<name>.js" from a
// part, or "../../<name>.js" for a shared file, names a lib file. Installed, every lib file sits in the
// feature's lib/: a part imports "../lib/<name>.js" and a lib file imports "./<name>.js".
const SOURCE_LIB_IMPORT_PATTERN = /(?:\.\.\/)+([^"'/]+\.js)(?=["'])/g;
const HOOK_PART_FOLDERS = ["hooks", "watchers", "command"];

const copyLibFiles = async (input: { sourceFolder: string; destinationFolder: string }): Promise<void> => {
  const isSourcePresent = await isPathPresent(input.sourceFolder);
  if (!isSourcePresent) {
    return;
  }

  const entries = await readdir(input.sourceFolder, { withFileTypes: true });
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  for (const fileName of fileNames) {
    await copyFile({
      source: path.join(input.sourceFolder, fileName),
      destination: path.join(input.destinationFolder, fileName),
    });
  }
};

const rewriteLibImportsInFolder = async (input: { folder: string; importPrefix: string }): Promise<void> => {
  const isFolderPresent = await isPathPresent(input.folder);
  if (!isFolderPresent) {
    return;
  }

  const entryNames = await readdir(input.folder);
  const jsFileNames = entryNames.filter((name) => name.endsWith(".js"));
  for (const jsFileName of jsFileNames) {
    const filePath = path.join(input.folder, jsFileName);
    const source = await readFile(filePath, "utf8");
    const libImportsRewritten = source.replace(SOURCE_LIB_IMPORT_PATTERN, `${input.importPrefix}$1`);
    await writeFile(filePath, libImportsRewritten);
  }
};

const copyHookFeature = async (input: {
  packageRoot: string;
  preparedRoot: string;
  sourceDirectory: string;
}): Promise<void> => {
  const compiledHooksRoot = path.join(input.packageRoot, "dist", "src", "hooks");
  const compiledFeatureRoot = path.join(compiledHooksRoot, input.sourceDirectory);
  const preparedFeatureRoot = path.join(input.preparedRoot, "hooks", input.sourceDirectory);
  const preparedLibFolder = path.join(preparedFeatureRoot, "lib");
  const isFeatureCompiled = await isPathPresent(compiledFeatureRoot);
  if (!isFeatureCompiled) {
    return;
  }

  for (const part of HOOK_PART_FOLDERS) {
    await copyTree({
      source: path.join(compiledFeatureRoot, part),
      destination: path.join(preparedFeatureRoot, part),
    });
  }

  await copyLibFiles({ sourceFolder: compiledFeatureRoot, destinationFolder: preparedLibFolder });
  await copyLibFiles({ sourceFolder: compiledHooksRoot, destinationFolder: preparedLibFolder });

  for (const part of HOOK_PART_FOLDERS) {
    await rewriteLibImportsInFolder({ folder: path.join(preparedFeatureRoot, part), importPrefix: "../lib/" });
  }
  await rewriteLibImportsInFolder({ folder: preparedLibFolder, importPrefix: "./" });
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
