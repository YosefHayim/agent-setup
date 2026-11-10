import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { joinZodIssueMessages } from "../zod-issue-messages.js";
import { isNotFound } from "./file-bytes.js";
import { versionSchema } from "./receipt.js";

const packageManifestSchema = z.object({
  version: versionSchema.describe("Semantic package version published in the ownership receipt."),
});

const createPackageError = (issue: string, cause?: unknown): Error =>
  new Error(`Cannot read the agent-setup package: ${issue}`, { cause });

const isFilePresent = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }

    throw error;
  }
};

const findPackageRootAbove = async (directory: string, moduleDirectory: string): Promise<string> => {
  const isPackageJsonHere = await isFilePresent(path.join(directory, "package.json"));
  if (isPackageJsonHere) {
    return directory;
  }

  const parentDirectory = path.dirname(directory);
  const isTopOfFileSystem = parentDirectory === directory;
  if (isTopOfFileSystem) {
    throw createPackageError(`no package.json above ${moduleDirectory}.`);
  }

  return findPackageRootAbove(parentDirectory, moduleDirectory);
};

// The same walk works from src/install (tsx) and dist/src/install (built package).
export const findPackageRoot = async (): Promise<string> => {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

  return findPackageRootAbove(moduleDirectory, moduleDirectory);
};

const readManifestSource = async (packageJsonPath: string): Promise<string> => {
  try {
    return await readFile(packageJsonPath, "utf8");
  } catch (error) {
    throw createPackageError(`${packageJsonPath}: ${String(error)}`, error);
  }
};

const parseManifestJson = (packageJsonPath: string, manifestSource: string): unknown => {
  try {
    return JSON.parse(manifestSource);
  } catch (error) {
    throw createPackageError(`${packageJsonPath} is not valid JSON: ${String(error)}`, error);
  }
};

export const readPackageVersion = async (): Promise<string> => {
  const packageJsonPath = path.join(await findPackageRoot(), "package.json");
  const manifestSource = await readManifestSource(packageJsonPath);
  const manifestJson = parseManifestJson(packageJsonPath, manifestSource);
  const manifestCheck = packageManifestSchema.safeParse(manifestJson);
  const isManifestValid = manifestCheck.success;
  if (isManifestValid) {
    return manifestCheck.data.version;
  }

  throw createPackageError(`${packageJsonPath} has no valid version: ${joinZodIssueMessages(manifestCheck.error)}`);
};
