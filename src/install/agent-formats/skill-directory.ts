import { z } from "zod";
import { agentDefinitionSchema, agentTargetSchema } from "../../catalog/agent-catalog.js";
import { installedSkillSchema } from "../../catalog/feature-catalog.js";
import { addZodIssueDetails, joinZodIssueMessages, type ZodIssueDetail } from "../../zod-issue-messages.js";
import { hashBytes } from "../file-bytes.js";
import {
  agentOwnerSchema,
  fileKindSchema,
  previousFileValueSchema,
  relativePathSchema,
  wholeFileOwnershipSchema,
} from "../ownership.js";
import { writeOperationSchema } from "../plan.js";

const createSkillPlanError = (issue: string): Error => new Error(`Cannot plan a skill directory: ${issue}`);

const underPath = (prefix: PropertyKey, issues: ReadonlyArray<ZodIssueDetail>): ReadonlyArray<ZodIssueDetail> =>
  issues.map((issue) => ({ ...issue, path: [prefix, ...issue.path] }));

// Destinations may land on case-insensitive filesystems, so paths are compared lowercased.
const normalizedPath = (path: string): string => path.toLowerCase();

const duplicatePathIssues = (paths: ReadonlyArray<string>): ReadonlyArray<ZodIssueDetail> =>
  paths.flatMap((path, index) => {
    const isFirstOccurrence =
      paths.findIndex((candidate) => normalizedPath(candidate) === normalizedPath(path)) === index;
    if (isFirstOccurrence) {
      return [];
    }

    return [{ path: [index], message: `Path ${path} conflicts with an earlier case-insensitive path.` }];
  });

const parentFileIssues = (paths: ReadonlyArray<string>): ReadonlyArray<ZodIssueDetail> =>
  paths.flatMap((path, index) => {
    const hasDescendant = paths.some((candidate) => normalizedPath(candidate).startsWith(`${normalizedPath(path)}/`));
    const isThereNoDescendant = !hasDescendant;
    if (isThereNoDescendant) {
      return [];
    }

    return [{ path: [index], message: `Path ${path} cannot be both a file and directory.` }];
  });

const isShippedFilePath = (path: string): boolean => /(?:^|\/)[^/]+\.[^/]+$/.test(path);

const matchesShippedPath = (path: string, shippedPath: string): boolean =>
  path === shippedPath || (!isShippedFilePath(shippedPath) && path.startsWith(`${shippedPath}/`));

const preparedSourceFileSchema = z.strictObject({
  path: relativePathSchema.describe("File path relative to one prepared installed-skill directory."),
  bytes: z.instanceof(Uint8Array).describe("Exact prepared source bytes read before pure format planning."),
});

type PreparedSourceFile = z.infer<typeof preparedSourceFileSchema>;

const preparedSkillFieldsSchema = z.strictObject({
  installedSkill: installedSkillSchema.describe("Catalog-owned installed skill and its exact shipped-path allowlist."),
  sourceFiles: z.array(preparedSourceFileSchema).describe("Complete prepared file snapshot for this installed skill."),
});

type PreparedSkillFields = z.infer<typeof preparedSkillFieldsSchema>;

// A shipped file path cannot also have descendants prepared under it.
const shippedFileWithDescendantIssue = (
  sourceFiles: ReadonlyArray<PreparedSourceFile>,
  shippedPath: string,
): ZodIssueDetail | null => {
  const isShippedFile = isShippedFilePath(shippedPath);
  const descendantIndex = sourceFiles.findIndex((file) =>
    normalizedPath(file.path).startsWith(`${normalizedPath(shippedPath)}/`),
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
const shippedDirectoryRootIssue = (
  sourceFiles: ReadonlyArray<PreparedSourceFile>,
  shippedPath: string,
): ZodIssueDetail | null => {
  const isShippedFile = isShippedFilePath(shippedPath);
  const rootIndex = sourceFiles.findIndex((file) => normalizedPath(file.path) === normalizedPath(shippedPath));
  const isThereNoIssue = isShippedFile || rootIndex < 0;
  if (isThereNoIssue) {
    return null;
  }

  return {
    path: ["sourceFiles", rootIndex, "path"],
    message: `Shipped directory root ${shippedPath} must contain prepared descendant files.`,
  };
};

const shippedPathShapeIssues = (skill: PreparedSkillFields): ReadonlyArray<ZodIssueDetail | null> =>
  skill.installedSkill.shippedPaths.flatMap((shippedPath) => [
    shippedFileWithDescendantIssue(skill.sourceFiles, shippedPath),
    shippedDirectoryRootIssue(skill.sourceFiles, shippedPath),
  ]);

const preparedSkillIssues = (skill: PreparedSkillFields): ReadonlyArray<ZodIssueDetail | null> => {
  const paths = skill.sourceFiles.map((file) => file.path);

  return [
    ...underPath("sourceFiles", duplicatePathIssues(paths)),
    ...underPath("sourceFiles", parentFileIssues(paths)),
    ...shippedPathShapeIssues(skill),
  ];
};

const preparedSkillSchema = preparedSkillFieldsSchema.superRefine((skill, context) =>
  addZodIssueDetails(context, preparedSkillIssues(skill)),
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
        previous: previousFileValueSchema.describe("Exact file state from before this destination first became owned."),
      }),
    )
    .describe("One exact restoration state for every desired destination."),
});

type SkillDirectoryRequestFields = z.infer<typeof skillDirectoryRequestFieldsSchema>;

const byPath = (left: { path: string }, right: { path: string }): number => {
  if (left.path === right.path) {
    return 0;
  }

  return left.path < right.path ? -1 : 1;
};

const selectedSourceFiles = (request: SkillDirectoryRequestFields) =>
  request.skills.flatMap(({ installedSkill, sourceFiles }) =>
    sourceFiles
      .filter((file) => installedSkill.shippedPaths.some((shippedPath) => matchesShippedPath(file.path, shippedPath)))
      .sort(byPath)
      .map((file) => ({ destination: `${request.agent.target.path}/${installedSkill.id}/${file.path}`, source: file })),
  );

const missingShippedPathIssues = (skills: ReadonlyArray<PreparedSkillFields>): ReadonlyArray<ZodIssueDetail> =>
  skills.flatMap((skill, skillIndex) =>
    skill.installedSkill.shippedPaths.flatMap((shippedPath, shippedPathIndex) => {
      const hasPreparedFile = skill.sourceFiles.some((file) => matchesShippedPath(file.path, shippedPath));
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

const duplicateInstalledSkillIssues = (skills: ReadonlyArray<PreparedSkillFields>): ReadonlyArray<ZodIssueDetail> =>
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

const previousFileIssues = (
  request: SkillDirectoryRequestFields,
  desiredPaths: ReadonlyArray<string>,
): ReadonlyArray<ZodIssueDetail> => [
  ...desiredPaths.flatMap((path) => {
    const hasPreviousState = request.previousFiles.some((file) => file.path === path);
    if (hasPreviousState) {
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

const skillDirectoryRequestIssues = (request: SkillDirectoryRequestFields): ReadonlyArray<ZodIssueDetail | null> => {
  const desiredPaths = selectedSourceFiles(request).map((file) => file.destination);

  return [
    ...duplicateInstalledSkillIssues(request.skills),
    ...missingShippedPathIssues(request.skills),
    ...underPath("previousFiles", duplicatePathIssues(request.previousFiles.map((file) => file.path))),
    ...underPath("skills", duplicatePathIssues(desiredPaths)),
    ...previousFileIssues(request, desiredPaths),
  ];
};

const skillDirectoryRequestSchema = skillDirectoryRequestFieldsSchema.superRefine((request, context) =>
  addZodIssueDetails(context, skillDirectoryRequestIssues(request)),
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
  file: { destination: string; source: { bytes: Uint8Array } },
): SkillWrite => {
  const previous = request.previousFiles.find((candidate) => candidate.path === file.destination);
  if (previous == null) {
    throw createSkillPlanError(`Missing previous-file state for desired skill file ${file.destination}.`);
  }

  const bytes = file.source.bytes;

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

    return { writes: selectedSourceFiles(request).map((file) => createSkillWrite(request, file)) };
  }

  throw createSkillPlanError(joinZodIssueMessages(requestCheck.error));
};
