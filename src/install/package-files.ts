import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  type FeatureId,
  featureCatalog,
  installedSkillSchema,
  skillsForFeatures,
} from "#src/catalog/feature-catalog.js";
import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "#src/zod-issue-messages.js";
import { decodeStrictString, hashBytes } from "./file-bytes.js";
import {
  applicationOwner,
  checkFileChange,
  readExpectedCurrent,
  readFileSnapshot,
  readPreviousWholeFile,
} from "./host-files.js";
import { hooksPath } from "./install-paths.js";
import { createInstallError, type InstallRequest } from "./install-request.js";
import type { FileChange } from "./plan.js";
import type { Receipt } from "./receipt.js";
import { nonEmptyTrimmedTextSchema } from "./text-rules.js";

const preparedFileSchema = z.object({
  path: nonEmptyTrimmedTextSchema.describe("Feature-runtime-relative prepared file path."),
  bytes: z.instanceof(Uint8Array).describe("Exact prepared runtime bytes copied into the installation."),
});

type PreparedFile = z.infer<typeof preparedFileSchema>;

const isUnderShippedPath = (filePath: string, shippedPath: string): boolean =>
  filePath === shippedPath || filePath.startsWith(`${shippedPath}/`);

const listPreparedSkillPathIssues = (preparedSkill: {
  installedSkill: z.infer<typeof installedSkillSchema>;
  sourceFiles: ReadonlyArray<PreparedFile>;
}): Array<ZodIssueDetail> => {
  const preparedFileIssues = preparedSkill.sourceFiles.flatMap((preparedFile, index) => {
    const isShippedFile = preparedSkill.installedSkill.shippedPaths.some((shippedPath) =>
      isUnderShippedPath(preparedFile.path, shippedPath),
    );
    if (isShippedFile) {
      return [];
    }

    return [
      {
        path: ["sourceFiles", index, "path"],
        message: `Prepared skill file ${preparedFile.path} is not catalog-shipped.`,
      },
    ];
  });

  const shippedPathIssues = preparedSkill.installedSkill.shippedPaths.flatMap((shippedPath, index) => {
    const isShippedPathPrepared = preparedSkill.sourceFiles.some((skillFile) =>
      isUnderShippedPath(skillFile.path, shippedPath),
    );
    if (isShippedPathPrepared) {
      return [];
    }

    return [
      {
        path: ["installedSkill", "shippedPaths", index],
        message: `Catalog-shipped path ${shippedPath} is missing from the prepared skill.`,
      },
    ];
  });

  return [...preparedFileIssues, ...shippedPathIssues];
};

const preparedSkillSchema = z
  .object({
    installedSkill: installedSkillSchema.describe("Catalog skill identity paired with its verified prepared files."),
    sourceFiles: z.array(preparedFileSchema).describe("Complete verified prepared skill file tree."),
    markdown: z.string().min(1).describe("Strict UTF-8 SKILL.md text used by native rule and instruction formats."),
  })
  .superRefine((preparedSkill, scope) => addZodIssueDetails(scope, listPreparedSkillPathIssues(preparedSkill)));

export type PreparedSkill = z.infer<typeof preparedSkillSchema>;

export const readInstalledHookFile = (featureFolderName: string, filePath: string): string =>
  `${hooksPath}/${featureFolderName}/${filePath}`;

// The compiled .js path a hook registration runs, relative to its feature's prepared hook folder.
export const readRegistrationEntrypoint = (
  runtime: { readonly sourceEntrypoint: string },
  registration: { readonly entrypoint: { _tag: "featureDefault" } | { _tag: "path"; value: string } },
): string => {
  const { entrypoint } = registration;
  const isCustomEntrypoint = entrypoint._tag === "path";
  const runtimeEntrypoint = isCustomEntrypoint ? entrypoint.value : runtime.sourceEntrypoint;

  return `${runtimeEntrypoint.slice(0, -3)}.js`;
};

const readPreparedFiles = async (directory: string): Promise<Array<PreparedFile>> => {
  const relativePaths = (await readdir(directory, { recursive: true })).sort();
  const files: Array<PreparedFile> = [];
  for (const relativePath of relativePaths) {
    const preparedPath = join(directory, relativePath);
    const pathStats = await stat(preparedPath);

    const isDirectory = pathStats.isDirectory();
    if (isDirectory) {
      continue;
    }

    const isNotRegularFile = !pathStats.isFile();
    if (isNotRegularFile) {
      throw createInstallError(`Prepared path ${preparedPath} must be a regular file.`);
    }

    const bytes = await readFile(preparedPath);
    files.push({ path: relativePath.replaceAll("\\", "/"), bytes });
  }

  return files;
};

interface HookFileWriteRequest {
  readonly request: InstallRequest;
  readonly previousReceipt: Receipt | null;
  readonly filePath: string;
  readonly bytes: Uint8Array;
}

const createHookFileWrite = async (fileWriteRequest: HookFileWriteRequest): Promise<FileChange> => {
  const { request, previousReceipt, filePath, bytes } = fileWriteRequest;
  const snapshot = await readFileSnapshot(join(request.destination.root, filePath));
  const previous = readPreviousWholeFile({
    receipt: previousReceipt,
    filePath,
    snapshot,
    desiredBytes: bytes,
  });

  return checkFileChange({
    _tag: "write",
    file: {
      owner: applicationOwner,
      path: filePath,
      kind: { _tag: "runtime" },
      ownership: { _tag: "wholeFile", installedHash: hashBytes(bytes), previous },
    },
    bytes,
    expectedCurrent: readExpectedCurrent(snapshot),
  });
};

interface HookWritesRequest {
  readonly request: InstallRequest;
  readonly featureIds: ReadonlyArray<string>;
  readonly previousReceipt: Receipt | null;
}

export const createHookWrites = async (hookWritesRequest: HookWritesRequest): Promise<Array<FileChange>> => {
  const { request, featureIds, previousReceipt } = hookWritesRequest;
  const hookFeatures = featureCatalog.flatMap((feature) => {
    const isSelected = featureIds.includes(feature.id);
    const { runtime } = feature;

    const isHookRuntime = runtime._tag === "hook";

    const isHookRuntimeSelected = isSelected && isHookRuntime;
    if (isHookRuntimeSelected) {
      return [{ sourceDirectory: feature.sourceDirectory, runtime }];
    }

    return [];
  });

  const writes: Array<FileChange> = [];
  for (const { sourceDirectory: featureFolderName, runtime } of hookFeatures) {
    const files = await readPreparedFiles(join(request.preparedPackage.root, "hooks", featureFolderName));
    for (const registration of runtime.registrations) {
      const entrypoint = readRegistrationEntrypoint(runtime, registration);

      const isEntrypointMissing = !files.some((file) => file.path === entrypoint);
      if (isEntrypointMissing) {
        throw createInstallError(`Prepared runtime entrypoint is missing: ${featureFolderName}/${entrypoint}`);
      }
    }

    for (const file of files) {
      const fileWrite = await createHookFileWrite({
        request,
        previousReceipt,
        filePath: readInstalledHookFile(featureFolderName, file.path),
        bytes: file.bytes,
      });
      writes.push(fileWrite);
    }
  }

  return writes;
};

const readPreparedSkill = async (
  preparedPackageRoot: string,
  installedSkill: z.infer<typeof installedSkillSchema>,
): Promise<PreparedSkill> => {
  const directory = join(preparedPackageRoot, "skills", installedSkill.id);
  const preparedFiles = await readPreparedFiles(directory);
  const skillFile = preparedFiles.find((file) => file.path === "SKILL.md");

  const isSkillFileMissing = skillFile == null;
  if (isSkillFileMissing) {
    throw createInstallError(`Prepared skill ${installedSkill.id} is missing SKILL.md.`);
  }

  const markdownReply = decodeStrictString(skillFile.bytes, join(directory, "SKILL.md"));

  const isMarkdownInvalid = markdownReply._tag === "invalid";
  if (isMarkdownInvalid) {
    throw createInstallError(markdownReply.message);
  }

  const preparedSkillReply = preparedSkillSchema.safeParse({
    installedSkill,
    sourceFiles: preparedFiles,
    markdown: markdownReply.fileContents,
  });

  const isPreparedSkillInvalid = !preparedSkillReply.success;
  if (isPreparedSkillInvalid) {
    const issueString = joinZodIssueMessages(preparedSkillReply.error);
    throw createInstallError(`Prepared skill ${installedSkill.id} is invalid: ${issueString}`);
  }

  return preparedSkillReply.data;
};

interface PreparedSkillsRequest {
  readonly request: InstallRequest;
  readonly featureIds: ReadonlyArray<FeatureId>;
}

export const readPreparedSkills = async (skillsRequest: PreparedSkillsRequest): Promise<Array<PreparedSkill>> => {
  const preparedSkills: Array<PreparedSkill> = [];
  for (const installedSkill of skillsForFeatures(skillsRequest.featureIds)) {
    const preparedSkill = await readPreparedSkill(skillsRequest.request.preparedPackage.root, installedSkill);
    preparedSkills.push(preparedSkill);
  }

  return preparedSkills;
};
