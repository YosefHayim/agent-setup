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
import { stripFrontmatter, withCompleteFrontmatter } from "./skill-text.js";

const textEncoder = new TextEncoder();

class RuleFilePlanError extends Schema.TaggedError<RuleFilePlanError>()("RuleFilePlanError", {
  issue: Schema.NonEmptyString.annotations({
    description: "Actionable rule-file request issue.",
  }),
}) {
  get message(): string {
    return `Cannot plan rule files: ${this.issue}`;
  }
}

const ruleFileAgentSchema = Schema.Struct({
  ...agentDefinitionSchema.fields,
  target: agentDefinitionSchema.fields.target.members[1],
});

const ruleFileSkillSchema = Schema.Struct({
  installedSkill: installedSkillSchema.annotations({
    description: "Catalog-owned installed skill identity used for the output filename.",
  }),
  markdown: withCompleteFrontmatter(Schema.String).pipe(
    Schema.filter((markdown) => stripFrontmatter(markdown).trim().length > 0, {
      message: () => "Rule-file markdown requires a non-empty body after frontmatter.",
    }),
    Schema.annotations({
      description: "Exact installed SKILL.md text used to produce one native rule body.",
    }),
  ),
});

const previousRuleFileSchema = Schema.Struct({
  path: relativePathSchema.annotations({
    description: "Exact rule path whose original state is retained for restoration.",
  }),
  previous: Schema.typeSchema(previousFileValueSchema).annotations({
    description: "Decoded original whole-file state retained across updates.",
  }),
});

const ruleFileRequestFieldsSchema = Schema.Struct({
  agent: ruleFileAgentSchema.annotations({
    description: "Decoded agent whose target selects the native rule-file format.",
  }),
  skills: Schema.Array(ruleFileSkillSchema).pipe(
    Schema.filter((skills) => skills.length === new Set(skills.map((skill) => skill.installedSkill.id)).size, {
      message: () => "Installed rule-file skill IDs must be unique.",
    }),
    Schema.annotations({
      description: "Ordered installed skill markdown values rendered into separate rule files.",
    }),
  ),
  previousFiles: Schema.Array(previousRuleFileSchema).pipe(
    Schema.filter((files) => files.length === new Set(files.map((file) => file.path)).size, {
      message: () => "Previous rule-file paths must be unique.",
    }),
    Schema.annotations({
      description: "Exact original file state for every desired rule path, in skill order.",
    }),
  ),
});

type RuleFileRequestFields = Schema.Schema.Type<typeof ruleFileRequestFieldsSchema>;

const rulePath = (request: RuleFileRequestFields, skillId: string): string =>
  `${request.agent.target.directory}/${skillId}${request.agent.target.extension}`;

const exactPreviousFileIssues = (request: RuleFileRequestFields) => {
  const expectedPaths = request.skills.map((skill) => rulePath(request, skill.installedSkill.id));
  const previousPaths = request.previousFiles.map((file) => file.path);
  const mismatchIndex = expectedPaths.findIndex((path, index) => path !== previousPaths[index]);
  if (mismatchIndex < 0 && expectedPaths.length === previousPaths.length) {
    return [];
  }

  return [
    {
      path: ["previousFiles", mismatchIndex < 0 ? Math.min(expectedPaths.length, previousPaths.length) : mismatchIndex],
      message: "Previous rule-file paths must exactly match desired rule paths in skill order.",
    },
  ];
};

export const ruleFileRequestSchema = ruleFileRequestFieldsSchema.pipe(Schema.filter(exactPreviousFileIssues));

type RuleFileRequest = Schema.Schema.Type<typeof ruleFileRequestSchema>;

const ruleFileWriteSchema = Schema.TaggedStruct("write", {
  file: Schema.Struct({
    owner: fileOwnerSchema.members[1],
    path: relativePathSchema,
    kind: fileKindSchema.members[2],
    ownership: wholeFileOwnershipSchema,
  }),
  bytes: writeOperationSchema.fields.bytes,
});

type RuleFileWrite = Schema.Schema.Type<typeof ruleFileWriteSchema>;

const ruleFilePlanSchema = Schema.Struct({
  writes: Schema.Array(ruleFileWriteSchema).annotations({
    description: "Ordered desired rule writes with matching whole-file ownership.",
  }),
});

type RuleFilePlan = Schema.Schema.Type<typeof ruleFilePlanSchema>;

const createRuleWrite = (
  request: RuleFileRequest,
  skill: RuleFileRequest["skills"][number],
): Either.Either<RuleFileWrite, RuleFilePlanError> => {
  const path = rulePath(request, skill.installedSkill.id);
  const previousFile = request.previousFiles.find((file) => file.path === path);
  if (previousFile === undefined) {
    return Either.left(new RuleFilePlanError({ issue: `Missing previous-file state for desired rule file ${path}.` }));
  }

  const bytes = textEncoder.encode(stripFrontmatter(skill.markdown));

  return Either.right({
    _tag: "write",
    file: {
      path,
      kind: { _tag: "rule" },
      owner: { _tag: "agent", agentIds: [request.agent.id] },
      ownership: { _tag: "wholeFile", installedHash: hashBytes(bytes), previous: previousFile.previous },
    },
    bytes,
  });
};

const toPlanError = (error: SchemaParseIssue.ParseError) =>
  new RuleFilePlanError({ issue: SchemaParseIssue.TreeFormatter.formatErrorSync(error) });

// Plan native rule files without I/O: one whole-file write per skill.
export const planRuleFiles = (input: unknown): Either.Either<RuleFilePlan, RuleFilePlanError> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(ruleFileRequestSchema, { onExcessProperty: "error" })(input),
    toPlanError,
  ).pipe(
    Either.flatMap((request) => Either.all(request.skills.map((skill) => createRuleWrite(request, skill)))),
    Either.map((writes) => ({ writes })),
  );
