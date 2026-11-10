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
import { decodeStrictText, hashBytes } from "./file-bytes.js";
import {
  applicationOwner,
  checkFileChange,
  expectedCurrent,
  previousWholeFile,
  readFileSnapshot,
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

const preparedSkillPathIssues = (preparedSkill: {
  installedSkill: z.infer<typeof installedSkillSchema>;
  sourceFiles: ReadonlyArray<PreparedFile>;
}): Array<ZodIssueDetail> => {
  const sourceFileIssues = preparedSkill.sourceFiles.flatMap((sourceFile, index) => {
    const isShippedFile = preparedSkill.installedSkill.shippedPaths.some((shippedPath) =>
      isUnderShippedPath(sourceFile.path, shippedPath),
    );
    if (isShippedFile) {
      return [];
    }

    return [
      {
        path: ["sourceFiles", index, "path"],
        message: `Prepared skill file ${sourceFile.path} is not catalog-shipped.`,
      },
    ];
  });

  const shippedPathIssues = preparedSkill.installedSkill.shippedPaths.flatMap((shippedPath, index) => {
    const isShippedPathPrepared = preparedSkill.sourceFiles.some((sourceFile) =>
      isUnderShippedPath(sourceFile.path, shippedPath),
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

  return [...sourceFileIssues, ...shippedPathIssues];
};

const preparedSkillSchema = z
  .object({
    installedSkill: installedSkillSchema.describe("Catalog skill identity paired with its verified prepared files."),
    sourceFiles: z.array(preparedFileSchema).describe("Complete verified prepared skill file tree."),
    markdown: z.string().min(1).describe("Strict UTF-8 SKILL.md text used by native rule and instruction formats."),
  })
  .superRefine((preparedSkill, context) => addZodIssueDetails(context, preparedSkillPathIssues(preparedSkill)));

export type PreparedSkill = z.infer<typeof preparedSkillSchema>;

export const installedHookFile = (sourceDirectory: string, filePath: string): string =>
  `${hooksPath}/${sourceDirectory}/${filePath}`;

// The compiled .js path a hook registration runs, relative to its feature's prepared hook folder.
export const registrationEntrypoint = (
  runtime: { readonly sourceEntrypoint: string },
  registration: { readonly entrypoint: { _tag: "featureDefault" } | { _tag: "path"; value: string } },
): string => {
  const { entrypoint } = registration;
  const isCustomEntrypoint = entrypoint._tag === "path";
  const sourceEntrypoint = isCustomEntrypoint ? entrypoint.value : runtime.sourceEntrypoint;

  return `${sourceEntrypoint.slice(0, -3)}.js`;
};

const readPreparedFiles = async (directory: string): Promise<Array<PreparedFile>> => {
  const relativePaths = (await readdir(directory, { recursive: true })).sort();
  const files: Array<PreparedFile> = [];
  for (const relativePath of relativePaths) {
    const sourcePath = join(directory, relativePath);
    const entryStats = await stat(sourcePath);
    const isDirectory = entryStats.isDirectory();
    if (isDirectory) {
      continue;
    }

    const isNotRegularFile = !entryStats.isFile();
    if (isNotRegularFile) {
      throw createInstallError(`Prepared path ${sourcePath} must be a regular file.`);
    }

    const bytes = await readFile(sourcePath);
    files.push({ path: relativePath.replaceAll("\\", "/"), bytes });
  }

  return files;
};

interface HookFileWriteRequest {
  readonly request: InstallRequest;
  readonly previousReceipt: Receipt | undefined;
  readonly filePath: string;
  readonly bytes: Uint8Array;
}

const createHookFileWrite = async (fileWriteRequest: HookFileWriteRequest): Promise<FileChange> => {
  const { request, previousReceipt, filePath, bytes } = fileWriteRequest;
  const snapshot = await readFileSnapshot(join(request.destination.root, filePath));
  const previous = previousWholeFile({
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
    expectedCurrent: expectedCurrent(snapshot),
  });
};

interface HookWritesRequest {
  readonly request: InstallRequest;
  readonly featureIds: ReadonlyArray<string>;
  readonly previousReceipt: Receipt | undefined;
}

export const createHookWrites = async (hookWritesRequest: HookWritesRequest): Promise<Array<FileChange>> => {
  const { request, featureIds, previousReceipt } = hookWritesRequest;
  const hookFeatures = featureCatalog.flatMap((feature) => {
    const isSelected = featureIds.includes(feature.id);
    const { runtime } = feature;
    const isHookRuntime = runtime._tag === "hook";
    if (isSelected && isHookRuntime) {
      return [{ sourceDirectory: feature.sourceDirectory, runtime }];
    }

    return [];
  });

  const writes: Array<FileChange> = [];
  for (const { sourceDirectory, runtime } of hookFeatures) {
    const files = await readPreparedFiles(join(request.preparedPackage.root, "hooks", sourceDirectory));
    for (const registration of runtime.registrations) {
      const entrypoint = registrationEntrypoint(runtime, registration);
      const isEntrypointMissing = !files.some((file) => file.path === entrypoint);
      if (isEntrypointMissing) {
        throw createInstallError(`Prepared runtime entrypoint is missing: ${sourceDirectory}/${entrypoint}`);
      }
    }

    for (const file of files) {
      const fileWrite = await createHookFileWrite({
        request,
        previousReceipt,
        filePath: installedHookFile(sourceDirectory, file.path),
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
  const sourceFiles = await readPreparedFiles(directory);
  const skillFile = sourceFiles.find((file) => file.path === "SKILL.md");
  const isSkillFileMissing = skillFile == null;
  if (isSkillFileMissing) {
    throw createInstallError(`Prepared skill ${installedSkill.id} is missing SKILL.md.`);
  }

  const markdownReply = decodeStrictText(skillFile.bytes, join(directory, "SKILL.md"));
  const isMarkdownInvalid = markdownReply._tag === "invalid";
  if (isMarkdownInvalid) {
    throw createInstallError(markdownReply.message);
  }

  const preparedSkillReply = preparedSkillSchema.safeParse({
    installedSkill,
    sourceFiles,
    markdown: markdownReply.fileContents,
  });
  const isPreparedSkillInvalid = !preparedSkillReply.success;
  if (isPreparedSkillInvalid) {
    const issueText = joinZodIssueMessages(preparedSkillReply.error);
    throw createInstallError(`Prepared skill ${installedSkill.id} is invalid: ${issueText}`);
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
