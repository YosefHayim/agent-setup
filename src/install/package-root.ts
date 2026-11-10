import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { joinZodIssueMessages } from "#src/zod-issue-messages.js";
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
  const isPackageDocumentHere = await isFilePresent(path.join(directory, "package.json"));
  if (isPackageDocumentHere) {
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

const readManifestOrigin = async (packageDocumentPath: string): Promise<string> => {
  try {
    return await readFile(packageDocumentPath, "utf8");
  } catch (error) {
    throw createPackageError(`${packageDocumentPath}: ${String(error)}`, error);
  }
};

const parseManifestDocument = (packageDocumentPath: string, manifestOrigin: string): unknown => {
  try {
    return JSON.parse(manifestOrigin);
  } catch (error) {
    throw createPackageError(`${packageDocumentPath} is not valid JSON: ${String(error)}`, error);
  }
};

export const readPackageVersion = async (): Promise<string> => {
  const packageDocumentPath = path.join(await findPackageRoot(), "package.json");
  const manifestOrigin = await readManifestOrigin(packageDocumentPath);
  const manifestDocument = parseManifestDocument(packageDocumentPath, manifestOrigin);
  const manifestCheck = packageManifestSchema.safeParse(manifestDocument);

  const isManifestValid = manifestCheck.success;
  if (isManifestValid) {
    return manifestCheck.data.version;
  }

  throw createPackageError(`${packageDocumentPath} has no valid version: ${joinZodIssueMessages(manifestCheck.error)}`);
};
