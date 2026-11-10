import { z } from "zod";
import { agentDefinitionSchema, agentTargetSchema } from "#src/catalog/agent-catalog.js";
import { installedSkillSchema } from "#src/catalog/feature-catalog.js";
import { hashBytes } from "#src/install/file-bytes.js";
import {
  agentOwnerSchema,
  fileKindSchema,
  previousFileFieldSchema,
  relativePathSchema,
  wholeFileOwnershipSchema,
} from "#src/install/ownership.js";
import { writeOperationSchema } from "#src/install/plan.js";
import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "#src/zod-issue-messages.js";

const createSkillPlanError = (issue: string): Error => new Error(`Cannot plan a skill directory: ${issue}`);

const listUnderPath = (prefix: PropertyKey, issues: ReadonlyArray<ZodIssueDetail>): ReadonlyArray<ZodIssueDetail> =>
  issues.map((issue) => ({ ...issue, path: [prefix, ...issue.path] }));

// Destinations may land on case-insensitive filesystems, so paths are compared lowercased.
const readNormalizedPath = (path: string): string => path.toLowerCase();

const listDuplicatePathIssues = (paths: ReadonlyArray<string>): ReadonlyArray<ZodIssueDetail> =>
  paths.flatMap((path, index) => {
    const isFirstOccurrence =
      paths.findIndex((candidate) => readNormalizedPath(candidate) === readNormalizedPath(path)) === index;
    if (isFirstOccurrence) {
      return [];
    }

    return [{ path: [index], message: `Path ${path} conflicts with an earlier case-insensitive path.` }];
  });

const listParentFileIssues = (paths: ReadonlyArray<string>): ReadonlyArray<ZodIssueDetail> =>
  paths.flatMap((path, index) => {
    const hasDescendant = paths.some((candidate) =>
      readNormalizedPath(candidate).startsWith(`${readNormalizedPath(path)}/`),
    );

    const isThereNoDescendant = !hasDescendant;
    if (isThereNoDescendant) {
      return [];
    }

    return [{ path: [index], message: `Path ${path} cannot be both a file and directory.` }];
  });

const isShippedFilePath = (path: string): boolean => /(?:^|\/)[^/]+\.[^/]+$/.test(path);

const isForShippedPath = (path: string, shippedPath: string): boolean =>
  path === shippedPath || (!isShippedFilePath(shippedPath) && path.startsWith(`${shippedPath}/`));

const preparedSkillFileSchema = z.strictObject({
  path: relativePathSchema.describe("File path relative to one prepared installed-skill directory."),
  bytes: z.instanceof(Uint8Array).describe("Exact prepared source bytes read before pure format planning."),
});

type PreparedSkillFile = z.infer<typeof preparedSkillFileSchema>;

const preparedSkillFieldsSchema = z.strictObject({
  installedSkill: installedSkillSchema.describe("Catalog-owned installed skill and its exact shipped-path allowlist."),
  sourceFiles: z.array(preparedSkillFileSchema).describe("Complete prepared file snapshot for this installed skill."),
});

type PreparedSkillFields = z.infer<typeof preparedSkillFieldsSchema>;

// A shipped file path cannot also have descendants prepared under it.
const readShippedFileWithDescendantIssue = (
  preparedFiles: ReadonlyArray<PreparedSkillFile>,
  shippedPath: string,
): ZodIssueDetail | null => {
  const isShippedFile = isShippedFilePath(shippedPath);
  const descendantIndex = preparedFiles.findIndex((file) =>
    readNormalizedPath(file.path).startsWith(`${readNormalizedPath(shippedPath)}/`),
  );

  const isThereNoIssue = !isShippedFile || descendantIndex < 0;
  if (isThereNoIssue) {
    return null;
  }

  return {
    path: ["sourceFiles", descendantIndex, "path"],
    message: `Shipped file path ${shippedPath} cannot be prepared as a directory.`,
  };
};

// A shipped directory root cannot also be a prepared file.
const readShippedDirectoryRootIssue = (
  preparedFiles: ReadonlyArray<PreparedSkillFile>,
  shippedPath: string,
): ZodIssueDetail | null => {
  const isShippedFile = isShippedFilePath(shippedPath);
  const rootIndex = preparedFiles.findIndex(
    (file) => readNormalizedPath(file.path) === readNormalizedPath(shippedPath),
  );

  const isThereNoIssue = isShippedFile || rootIndex < 0;
  if (isThereNoIssue) {
    return null;
  }

  return {
    path: ["sourceFiles", rootIndex, "path"],
    message: `Shipped directory root ${shippedPath} must contain prepared descendant files.`,
  };
};

const listShippedPathShapeIssues = (skill: PreparedSkillFields): ReadonlyArray<ZodIssueDetail | null> =>
  skill.installedSkill.shippedPaths.flatMap((shippedPath) => [
    readShippedFileWithDescendantIssue(skill.sourceFiles, shippedPath),
    readShippedDirectoryRootIssue(skill.sourceFiles, shippedPath),
  ]);

const listPreparedSkillIssues = (skill: PreparedSkillFields): ReadonlyArray<ZodIssueDetail | null> => {
  const paths = skill.sourceFiles.map((file) => file.path);

  return [
    ...listUnderPath("sourceFiles", listDuplicatePathIssues(paths)),
    ...listUnderPath("sourceFiles", listParentFileIssues(paths)),
    ...listShippedPathShapeIssues(skill),
  ];
};

const preparedSkillSchema = preparedSkillFieldsSchema.superRefine((skill, scope) =>
  addZodIssueDetails(scope, listPreparedSkillIssues(skill)),
);

const skillDirectoryRequestFieldsSchema = z.strictObject({
  agent: agentDefinitionSchema
    .extend({ target: agentTargetSchema.options[0] })
    .describe("Catalog agent whose skill-directory target receives the desired files."),
  skills: z.array(preparedSkillSchema).describe("Ordered installed skills with complete prepared source snapshots."),
  previousFiles: z
    .array(
      z.strictObject({
        path: relativePathSchema.describe("Exact desired destination whose restoration state is known."),
        previous: previousFileFieldSchema.describe("Exact file state from before this destination first became owned."),
      }),
    )
    .describe("One exact restoration state for every desired destination."),
});

type SkillDirectoryRequestFields = z.infer<typeof skillDirectoryRequestFieldsSchema>;

const readByPath = (left: { path: string }, right: { path: string }): number => {
  const isSamePath = left.path === right.path;
  if (isSamePath) {
    return 0;
  }

  const isLeftPathFirst = left.path < right.path;
  return isLeftPathFirst ? -1 : 1;
};

const listSelectedSkillFiles = (request: SkillDirectoryRequestFields) =>
  request.skills.flatMap(({ installedSkill, sourceFiles: preparedFiles }) =>
    preparedFiles
      .filter((file) => installedSkill.shippedPaths.some((shippedPath) => isForShippedPath(file.path, shippedPath)))
      .sort(readByPath)
      .map((file) => ({
        destination: `${request.agent.target.path}/${installedSkill.id}/${file.path}`,
        preparedFile: file,
      })),
  );

const listMissingShippedPathIssues = (skills: ReadonlyArray<PreparedSkillFields>): ReadonlyArray<ZodIssueDetail> =>
  skills.flatMap((skill, skillIndex) =>
    skill.installedSkill.shippedPaths.flatMap((shippedPath, shippedPathIndex) => {
      const hasPreparedFile = skill.sourceFiles.some((file) => isForShippedPath(file.path, shippedPath));
      if (hasPreparedFile) {
        return [];
      }

      return [
        {
          path: ["skills", skillIndex, "installedSkill", "shippedPaths", shippedPathIndex],
          message: `Shipped path ${shippedPath} has no prepared file or directory descendants.`,
        },
      ];
    }),
  );

const listDuplicateInstalledSkillIssues = (skills: ReadonlyArray<PreparedSkillFields>): ReadonlyArray<ZodIssueDetail> =>
  skills.flatMap((skill, index) => {
    const isFirstOccurrence =
      skills.findIndex((candidate) => candidate.installedSkill.id === skill.installedSkill.id) === index;
    if (isFirstOccurrence) {
      return [];
    }

    return [
      {
        path: ["skills", index, "installedSkill", "id"],
        message: `Installed skill ${skill.installedSkill.id} appears more than once.`,
      },
    ];
  });

const listPreviousFileIssues = (
  request: SkillDirectoryRequestFields,
  desiredPaths: ReadonlyArray<string>,
): ReadonlyArray<ZodIssueDetail> => [
  ...desiredPaths.flatMap((path) => {
    const hasPreviousStatus = request.previousFiles.some((file) => file.path === path);
    if (hasPreviousStatus) {
      return [];
    }

    return [{ path: ["previousFiles"], message: `Desired skill file ${path} requires one exact previous-file state.` }];
  }),
  ...request.previousFiles.flatMap((file, index) => {
    const isDesiredPath = desiredPaths.includes(file.path);
    if (isDesiredPath) {
      return [];
    }

    return [
      {
        path: ["previousFiles", index, "path"],
        message: `Previous-file state ${file.path} does not belong to a desired skill file.`,
      },
    ];
  }),
];

const listSkillDirectoryRequestIssues = (
  request: SkillDirectoryRequestFields,
): ReadonlyArray<ZodIssueDetail | null> => {
  const desiredPaths = listSelectedSkillFiles(request).map((file) => file.destination);

  return [
    ...listDuplicateInstalledSkillIssues(request.skills),
    ...listMissingShippedPathIssues(request.skills),
    ...listUnderPath("previousFiles", listDuplicatePathIssues(request.previousFiles.map((file) => file.path))),
    ...listUnderPath("skills", listDuplicatePathIssues(desiredPaths)),
    ...listPreviousFileIssues(request, desiredPaths),
  ];
};

const skillDirectoryRequestSchema = skillDirectoryRequestFieldsSchema.superRefine((request, scope) =>
  addZodIssueDetails(scope, listSkillDirectoryRequestIssues(request)),
);

type SkillDirectoryRequest = z.infer<typeof skillDirectoryRequestSchema>;

const skillWriteSchema = z.strictObject({
  _tag: z.literal("write"),
  file: z.strictObject({
    owner: agentOwnerSchema,
    path: relativePathSchema,
    kind: fileKindSchema.options[1],
    ownership: wholeFileOwnershipSchema,
  }),
  bytes: writeOperationSchema.shape.bytes,
});

type SkillWrite = z.infer<typeof skillWriteSchema>;

// Ordered desired skill-file writes, each with matching whole-file ownership.
export type SkillDirectoryPlan = { writes: SkillWrite[] };

const createSkillWrite = (
  request: SkillDirectoryRequest,
  file: { destination: string; preparedFile: { bytes: Uint8Array } },
): SkillWrite => {
  const previous = request.previousFiles.find((candidate) => candidate.path === file.destination);

  const isPreviousMissing = previous == null;
  if (isPreviousMissing) {
    throw createSkillPlanError(`Missing previous-file state for desired skill file ${file.destination}.`);
  }

  const bytes = file.preparedFile.bytes;

  return {
    _tag: "write",
    file: {
      owner: { _tag: "agent", agentIds: [request.agent.id] },
      path: file.destination,
      kind: { _tag: "skill" },
      ownership: { _tag: "wholeFile", installedHash: hashBytes(bytes), previous: previous.previous },
    },
    bytes,
  };
};

// Plan one skill-directory target without I/O: every shipped file becomes one whole-file write.
export const planSkillDirectory = (candidateRequest: unknown): SkillDirectoryPlan => {
  const requestCheck = skillDirectoryRequestSchema.safeParse(candidateRequest);

  const isRequestAccepted = requestCheck.success;
  if (isRequestAccepted) {
    const request = requestCheck.data;

    return { writes: listSelectedSkillFiles(request).map((file) => createSkillWrite(request, file)) };
  }

  throw createSkillPlanError(joinZodIssueMessages(requestCheck.error));
};
