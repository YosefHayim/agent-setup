import { Either, Schema, ParseResult as SchemaParseIssue } from "effect";
import { agentDefinitionSchema } from "../../catalog/agent-catalog.js";
import { installedSkillSchema } from "../../catalog/feature-catalog.js";
import { hashBytes } from "../file-bytes.js";
import {
  fileKindSchema,
  fileOwnerSchema,
  previousFileValueSchema,
  relativePathSchema,
  wholeFileOwnershipSchema,
} from "../ownership.js";
import { writeOperationSchema } from "../plan.js";

export class SkillDirectoryPlanError extends Schema.TaggedError<SkillDirectoryPlanError>()("SkillDirectoryPlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable skill-directory request issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan a skill directory: ${this.issue}`;
  }
}

type PathIssue = { path: ReadonlyArray<PropertyKey>; message: string };

const underPath = (prefix: PropertyKey, issues: ReadonlyArray<PathIssue>) =>
  issues.map((issue) => ({ ...issue, path: [prefix, ...issue.path] }));

// Destinations may land on case-insensitive filesystems, so paths are compared lowercased.
const normalizedPath = (path: string): string => path.toLowerCase();

const duplicatePathIssues = (paths: ReadonlyArray<string>): ReadonlyArray<PathIssue> =>
  paths.flatMap((path, index) =>
    paths.findIndex((candidate) => normalizedPath(candidate) === normalizedPath(path)) === index
      ? []
      : [{ path: [index], message: `Path ${path} conflicts with an earlier case-insensitive path.` }],
  );

const parentFileIssues = (paths: ReadonlyArray<string>): ReadonlyArray<PathIssue> =>
  paths.flatMap((path, index) =>
    paths.some((candidate) => normalizedPath(candidate).startsWith(`${normalizedPath(path)}/`))
      ? [{ path: [index], message: `Path ${path} cannot be both a file and directory.` }]
      : [],
  );

const isShippedFilePath = (path: string): boolean => /(?:^|\/)[^/]+\.[^/]+$/.test(path);

const matchesShippedPath = (path: string, shippedPath: string): boolean =>
  path === shippedPath || (!isShippedFilePath(shippedPath) && path.startsWith(`${shippedPath}/`));

const preparedSkillFieldsSchema = Schema.Struct({
  installedSkill: installedSkillSchema.annotations({
    description: "Catalog-owned installed skill and its exact shipped-path allowlist.",
  }),
  sourceFiles: Schema.Array(
    Schema.Struct({
      path: relativePathSchema.annotations({
        description: "File path relative to one prepared installed-skill directory.",
      }),
      bytes: Schema.Uint8ArrayFromSelf.annotations({
        description: "Exact prepared source bytes read before pure format planning.",
      }),
    }),
  ).annotations({
    description: "Complete prepared file snapshot for this installed skill.",
  }),
});

type PreparedSkillFields = Schema.Schema.Type<typeof preparedSkillFieldsSchema>;

const shippedPathShapeIssues = (skill: PreparedSkillFields) =>
  skill.installedSkill.shippedPaths.flatMap((shippedPath) => {
    const rootIndex = skill.sourceFiles.findIndex((file) => normalizedPath(file.path) === normalizedPath(shippedPath));
    const descendantIndex = skill.sourceFiles.findIndex((file) =>
      normalizedPath(file.path).startsWith(`${normalizedPath(shippedPath)}/`),
    );
    const shippedPathIsFile = isShippedFilePath(shippedPath);

    return [
      shippedPathIsFile && descendantIndex >= 0
        ? {
            path: ["sourceFiles", descendantIndex, "path"],
            message: `Shipped file path ${shippedPath} cannot be prepared as a directory.`,
          }
        : undefined,
      !shippedPathIsFile && rootIndex >= 0
        ? {
            path: ["sourceFiles", rootIndex, "path"],
            message: `Shipped directory root ${shippedPath} must contain prepared descendant files.`,
          }
        : undefined,
    ];
  });

const preparedSkillSchema = preparedSkillFieldsSchema.pipe(
  Schema.filter((skill) => {
    const paths = skill.sourceFiles.map((file) => file.path);

    return [
      ...underPath("sourceFiles", duplicatePathIssues(paths)),
      ...underPath("sourceFiles", parentFileIssues(paths)),
      ...shippedPathShapeIssues(skill),
    ];
  }),
);

const skillDirectoryRequestFieldsSchema = Schema.Struct({
  agent: Schema.Struct({
    ...agentDefinitionSchema.fields,
    target: agentDefinitionSchema.fields.target.members[0],
  }).annotations({
    description: "Catalog agent whose skill-directory target receives the desired files.",
  }),
  skills: Schema.Array(preparedSkillSchema).annotations({
    description: "Ordered installed skills with complete prepared source snapshots.",
  }),
  previousFiles: Schema.Array(
    Schema.Struct({
      path: relativePathSchema.annotations({
        description: "Exact desired destination whose restoration state is known.",
      }),
      previous: Schema.typeSchema(previousFileValueSchema).annotations({
        description: "Exact file state from before this destination first became owned.",
      }),
    }),
  ).annotations({
    description: "One exact restoration state for every desired destination.",
  }),
});

type SkillDirectoryRequestFields = Schema.Schema.Type<typeof skillDirectoryRequestFieldsSchema>;

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

const missingShippedPathIssues = (skills: ReadonlyArray<PreparedSkillFields>) =>
  skills.flatMap((skill, skillIndex) =>
    skill.installedSkill.shippedPaths.flatMap((shippedPath, shippedPathIndex) =>
      skill.sourceFiles.some((file) => matchesShippedPath(file.path, shippedPath))
        ? []
        : [
            {
              path: ["skills", skillIndex, "installedSkill", "shippedPaths", shippedPathIndex],
              message: `Shipped path ${shippedPath} has no prepared file or directory descendants.`,
            },
          ],
    ),
  );

const duplicateInstalledSkillIssues = (skills: ReadonlyArray<PreparedSkillFields>) =>
  skills.flatMap((skill, index) =>
    skills.findIndex((candidate) => candidate.installedSkill.id === skill.installedSkill.id) === index
      ? []
      : [
          {
            path: ["skills", index, "installedSkill", "id"],
            message: `Installed skill ${skill.installedSkill.id} appears more than once.`,
          },
        ],
  );

const previousFileIssues = (request: SkillDirectoryRequestFields, desiredPaths: ReadonlyArray<string>) => [
  ...desiredPaths.flatMap((path) =>
    request.previousFiles.some((file) => file.path === path)
      ? []
      : [{ path: ["previousFiles"], message: `Desired skill file ${path} requires one exact previous-file state.` }],
  ),
  ...request.previousFiles.flatMap((file, index) =>
    desiredPaths.includes(file.path)
      ? []
      : [
          {
            path: ["previousFiles", index, "path"],
            message: `Previous-file state ${file.path} does not belong to a desired skill file.`,
          },
        ],
  ),
];

const skillDirectoryRequestSchema = skillDirectoryRequestFieldsSchema.pipe(
  Schema.filter((request) => {
    const desiredPaths = selectedSourceFiles(request).map((file) => file.destination);

    return [
      ...duplicateInstalledSkillIssues(request.skills),
      ...missingShippedPathIssues(request.skills),
      ...underPath("previousFiles", duplicatePathIssues(request.previousFiles.map((file) => file.path))),
      ...underPath("skills", duplicatePathIssues(desiredPaths)),
      ...previousFileIssues(request, desiredPaths),
    ];
  }),
);

type SkillDirectoryRequest = Schema.Schema.Type<typeof skillDirectoryRequestSchema>;

const skillWriteSchema = Schema.TaggedStruct("write", {
  file: Schema.Struct({
    owner: fileOwnerSchema.members[1],
    path: relativePathSchema,
    kind: fileKindSchema.members[1],
    ownership: wholeFileOwnershipSchema,
  }),
  bytes: writeOperationSchema.fields.bytes,
});

type SkillWrite = Schema.Schema.Type<typeof skillWriteSchema>;

const skillDirectoryPlanSchema = Schema.Struct({
  writes: Schema.Array(skillWriteSchema).annotations({
    description: "Exact desired skill-file writes with matching whole-file ownership.",
  }),
});

export type SkillDirectoryPlan = Schema.Schema.Type<typeof skillDirectoryPlanSchema>;

const createSkillWrite = (
  request: SkillDirectoryRequest,
  file: { destination: string; source: { bytes: Uint8Array } },
): Either.Either<SkillWrite, SkillDirectoryPlanError> => {
  const previous = request.previousFiles.find((candidate) => candidate.path === file.destination);
  if (previous === undefined) {
    return Either.left(
      new SkillDirectoryPlanError({ issue: `Missing previous-file state for desired skill file ${file.destination}.` }),
    );
  }

  const bytes = file.source.bytes;

  return Either.right({
    _tag: "write",
    file: {
      owner: { _tag: "agent", agentIds: [request.agent.id] },
      path: file.destination,
      kind: { _tag: "skill" },
      ownership: { _tag: "wholeFile", installedHash: hashBytes(bytes), previous: previous.previous },
    },
    bytes,
  });
};

const toPlanError = (error: SchemaParseIssue.ParseError) =>
  new SkillDirectoryPlanError({ issue: SchemaParseIssue.TreeFormatter.formatErrorSync(error) });

// Plan one skill-directory target without I/O: every shipped file becomes one whole-file write.
export const planSkillDirectory = (input: unknown): Either.Either<SkillDirectoryPlan, SkillDirectoryPlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(skillDirectoryRequestSchema, { onExcessProperty: "error" })(input),
    toPlanError,
  ).pipe(
    Either.flatMap((request) =>
      Either.all(selectedSourceFiles(request).map((file) => createSkillWrite(request, file))),
    ),
    Either.map((writes) => ({ writes })),
  );
