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

const copyFile = async (details: { source: string; destination: string }): Promise<void> => {
  await mkdir(path.dirname(details.destination), { recursive: true });
  const originBytes = await readFile(details.source);
  await writeFile(details.destination, originBytes);
};

// Never copy install junk even when a catalog path is a directory allowlist.
const SKIPPED_TREE_NAMES = new Set(["node_modules", ".playwright", "out", ".git", ".DS_Store"]);

const copyTree = async (details: { source: string; destination: string }): Promise<void> => {
  const isOriginPresent = await isPathPresent(details.source);
  if (!isOriginPresent) {
    return;
  }

  const originStat = await stat(details.source);

  const isOriginFile = originStat.isFile();
  if (isOriginFile) {
    await copyFile(details);

    return;
  }

  const isNotOriginDirectory = !originStat.isDirectory();
  if (isNotOriginDirectory) {
    return;
  }

  await mkdir(details.destination, { recursive: true });
  const lineNames = await readdir(details.source);
  for (const lineName of lineNames) {
    const isNotSkippedLine = !SKIPPED_TREE_NAMES.has(lineName);
    if (isNotSkippedLine) {
      await copyTree({
        source: path.join(details.source, lineName),
        destination: path.join(details.destination, lineName),
      });
    }
  }
};

// Source hook code has no lib/ folder. A feature's lib files sit beside its hooks/, watchers/ and command/
// folders, and the shared hook files sit beside the feature folders. So a source import "../<name>.js" from a
// part, or "../../<name>.js" for a shared file, names a lib file. Installed, every lib file sits in the
// feature's lib/: a part imports "../lib/<name>.js" and a lib file imports "./<name>.js".
const ORIGIN_LIB_IMPORT_PATTERN = /(?:\.\.\/)+([^"'/]+\.js)(?=["'])/g;
const HOOK_PART_FOLDERS = ["hooks", "watchers", "command"];

const copyLibFiles = async (details: { sourceFolder: string; destinationFolder: string }): Promise<void> => {
  const isOriginPresent = await isPathPresent(details.sourceFolder);
  if (!isOriginPresent) {
    return;
  }

  const lines = await readdir(details.sourceFolder, { withFileTypes: true });
  const fileNames = lines.filter((line) => line.isFile()).map((directoryChild) => directoryChild.name);
  for (const fileName of fileNames) {
    await copyFile({
      source: path.join(details.sourceFolder, fileName),
      destination: path.join(details.destinationFolder, fileName),
    });
  }
};

const updateLibImportsInFolder = async (details: { folder: string; importPrefix: string }): Promise<void> => {
  const isNotFolderPresent = !(await isPathPresent(details.folder));
  if (isNotFolderPresent) {
    return;
  }

  const lineNames = await readdir(details.folder);
  const jsFileNames = lineNames.filter((name) => name.endsWith(".js"));
  for (const jsFileName of jsFileNames) {
    const filePath = path.join(details.folder, jsFileName);
    const code = await readFile(filePath, "utf8");
    const libImportsRewritten = code.replace(ORIGIN_LIB_IMPORT_PATTERN, `${details.importPrefix}$1`);
    await writeFile(filePath, libImportsRewritten);
  }
};

const copyHookFeature = async (details: {
  packageRoot: string;
  preparedRoot: string;
  sourceDirectory: string;
}): Promise<void> => {
  const compiledHooksRoot = path.join(details.packageRoot, "dist", "src", "hooks");
  const compiledFeatureRoot = path.join(compiledHooksRoot, details.sourceDirectory);
  const preparedFeatureRoot = path.join(details.preparedRoot, "hooks", details.sourceDirectory);
  const preparedLibFolder = path.join(preparedFeatureRoot, "lib");

  const isNotFeatureCompiled = !(await isPathPresent(compiledFeatureRoot));
  if (isNotFeatureCompiled) {
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
    await updateLibImportsInFolder({ folder: path.join(preparedFeatureRoot, part), importPrefix: "../lib/" });
  }
  await updateLibImportsInFolder({ folder: preparedLibFolder, importPrefix: "./" });
};

const copySkillFeature = async (details: {
  packageRoot: string;
  preparedRoot: string;
  sourceDirectory: string;
  skillId: string;
  shippedPaths: ReadonlyArray<string>;
}): Promise<void> => {
  const skillOriginRoot = path.join(details.packageRoot, "src", "skills", details.sourceDirectory);

  const isNotSkillOriginPresent = !(await isPathPresent(skillOriginRoot));
  if (isNotSkillOriginPresent) {
    throw createPreparePackageError(`Authored skill directory missing at ${skillOriginRoot}.`);
  }

  for (const shippedPath of details.shippedPaths) {
    const code = path.join(skillOriginRoot, shippedPath);

    const isNotShippedPathPresent = !(await isPathPresent(code));
    if (isNotShippedPathPresent) {
      throw createPreparePackageError(`Catalog-shipped path ${shippedPath} is missing under ${skillOriginRoot}.`);
    }

    await copyTree({
      source: code,
      destination: path.join(details.preparedRoot, "skills", details.skillId, shippedPath),
    });
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

  const isNotCompiledHooksPresent = !(await isPathPresent(compiledHooksRoot));
  if (isNotCompiledHooksPresent) {
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
