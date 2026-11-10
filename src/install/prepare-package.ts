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

    const isUnexpectedError = !isPathMissing;
    if (isUnexpectedError) {
      throw statError;
    }

    return false;
  }
};

const copyFile = async (copy: { fromPath: string; toPath: string }): Promise<void> => {
  await mkdir(path.dirname(copy.toPath), { recursive: true });
  const fileBytes = await readFile(copy.fromPath);
  await writeFile(copy.toPath, fileBytes);
};

// Never copy install junk even when a catalog path is a directory allowlist.
const SKIPPED_TREE_NAMES = new Set(["node_modules", ".playwright", "out", ".git", ".DS_Store"]);

const copyTree = async (copy: { fromPath: string; toPath: string }): Promise<void> => {
  const isFromPresent = await isPathPresent(copy.fromPath);
  const isFromMissing = !isFromPresent;
  if (isFromMissing) {
    return;
  }

  const fromStat = await stat(copy.fromPath);

  const isFromFile = fromStat.isFile();
  if (isFromFile) {
    await copyFile(copy);

    return;
  }

  const isNotFromDirectory = !fromStat.isDirectory();
  if (isNotFromDirectory) {
    return;
  }

  await mkdir(copy.toPath, { recursive: true });
  const childNames = await readdir(copy.fromPath);
  for (const childName of childNames) {
    const isNotSkippedName = !SKIPPED_TREE_NAMES.has(childName);
    if (isNotSkippedName) {
      await copyTree({
        fromPath: path.join(copy.fromPath, childName),
        toPath: path.join(copy.toPath, childName),
      });
    }
  }
};

// Source hook code has no lib/ folder. A feature's lib files sit beside its hooks/, watchers/ and command/
// folders, and the shared hook files sit beside the feature folders. So a source import "../<name>.js" from a
// part, or "../../<name>.js" for a shared file, names a lib file. Installed, every lib file sits in the
// feature's lib/: a part imports "../lib/<name>.js" and a lib file imports "./<name>.js".
const HOOK_PART_FOLDERS = ["hooks", "watchers", "command"];

const copyLibFiles = async (copy: { fromFolder: string; toFolder: string }): Promise<void> => {
  const isFromFolderPresent = await isPathPresent(copy.fromFolder);
  const isFromFolderMissing = !isFromFolderPresent;
  if (isFromFolderMissing) {
    return;
  }

  const folderChildren = await readdir(copy.fromFolder, { withFileTypes: true });
  const fileNames = folderChildren.filter((folderChild) => folderChild.isFile()).map((fileChild) => fileChild.name);
  for (const fileName of fileNames) {
    await copyFile({
      fromPath: path.join(copy.fromFolder, fileName),
      toPath: path.join(copy.toFolder, fileName),
    });
  }
};

const libImportPattern = /(?:\.\.\/)+([^"'/]+\.js)(?=["'])/g;

const updateLibImportsInFolder = async (rewrite: { folder: string; importPrefix: string }): Promise<void> => {
  const isFolderPresent = await isPathPresent(rewrite.folder);
  const isFolderMissing = !isFolderPresent;
  if (isFolderMissing) {
    return;
  }

  const childNames = await readdir(rewrite.folder);
  const jsFileNames = childNames.filter((childName) => childName.endsWith(".js"));
  for (const jsFileName of jsFileNames) {
    const filePath = path.join(rewrite.folder, jsFileName);
    const javascriptSource = await readFile(filePath, "utf8");
    const libImportsRewritten = javascriptSource.replace(libImportPattern, `${rewrite.importPrefix}$1`);
    await writeFile(filePath, libImportsRewritten);
  }
};

const copyHookFeature = async (hookFeature: {
  packageRoot: string;
  preparedRoot: string;
  featureFolderName: string;
}): Promise<void> => {
  const compiledHooksRoot = path.join(hookFeature.packageRoot, "dist", "src", "hooks");
  const compiledFeatureRoot = path.join(compiledHooksRoot, hookFeature.featureFolderName);
  const preparedFeatureRoot = path.join(hookFeature.preparedRoot, "hooks", hookFeature.featureFolderName);
  const preparedLibFolder = path.join(preparedFeatureRoot, "lib");

  const isCompiledFeaturePresent = await isPathPresent(compiledFeatureRoot);
  const isCompiledFeatureMissing = !isCompiledFeaturePresent;
  if (isCompiledFeatureMissing) {
    return;
  }

  for (const part of HOOK_PART_FOLDERS) {
    await copyTree({
      fromPath: path.join(compiledFeatureRoot, part),
      toPath: path.join(preparedFeatureRoot, part),
    });
  }

  await copyLibFiles({ fromFolder: compiledFeatureRoot, toFolder: preparedLibFolder });
  await copyLibFiles({ fromFolder: compiledHooksRoot, toFolder: preparedLibFolder });

  for (const part of HOOK_PART_FOLDERS) {
    await updateLibImportsInFolder({ folder: path.join(preparedFeatureRoot, part), importPrefix: "../lib/" });
  }
  await updateLibImportsInFolder({ folder: preparedLibFolder, importPrefix: "./" });
};

const copySkillFeature = async (skillCopy: {
  packageRoot: string;
  preparedRoot: string;
  featureFolderName: string;
  skillId: string;
  shippedPaths: ReadonlyArray<string>;
}): Promise<void> => {
  const authoredSkillRoot = path.join(skillCopy.packageRoot, "src", "skills", skillCopy.featureFolderName);

  const isAuthoredSkillPresent = await isPathPresent(authoredSkillRoot);
  const isAuthoredSkillMissing = !isAuthoredSkillPresent;
  if (isAuthoredSkillMissing) {
    throw createPreparePackageError(`Authored skill directory missing at ${authoredSkillRoot}.`);
  }

  for (const shippedPath of skillCopy.shippedPaths) {
    const authoredShippedPath = path.join(authoredSkillRoot, shippedPath);

    const isAuthoredShippedPresent = await isPathPresent(authoredShippedPath);
    const isAuthoredShippedMissing = !isAuthoredShippedPresent;
    if (isAuthoredShippedMissing) {
      throw createPreparePackageError(`Catalog-shipped path ${shippedPath} is missing under ${authoredSkillRoot}.`);
    }

    await copyTree({
      fromPath: authoredShippedPath,
      toPath: path.join(skillCopy.preparedRoot, "skills", skillCopy.skillId, shippedPath),
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

  const isCompiledHooksPresent = await isPathPresent(compiledHooksRoot);
  const isCompiledHooksMissing = !isCompiledHooksPresent;
  if (isCompiledHooksMissing) {
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
      await copyHookFeature({ packageRoot, preparedRoot, featureFolderName: feature.sourceDirectory });
    }

    const installedSkill = feature.installedSkill;

    const isSkillFeature = installedSkill._tag === "skill";
    if (isSkillFeature) {
      await copySkillFeature({
        packageRoot,
        preparedRoot,
        featureFolderName: feature.sourceDirectory,
        skillId: installedSkill.id,
        shippedPaths: installedSkill.shippedPaths,
      });
    }
  }

  return { root: preparedRoot, version };
};
