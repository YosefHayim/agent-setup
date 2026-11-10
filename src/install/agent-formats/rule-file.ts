import { z } from "zod";
import { agentDefinitionSchema, agentTargetSchema } from "#src/catalog/agent-catalog.js";
import { installedSkillSchema } from "#src/catalog/feature-catalog.js";
import { hashBytes } from "#src/install/file-bytes.js";
import {
  agentOwnerSchema,
  fileKindSchema,
  previousFileValueSchema,
  relativePathSchema,
  wholeFileOwnershipSchema,
} from "#src/install/ownership.js";
import { writeOperationSchema } from "#src/install/plan.js";
import { addZodIssueDetails, joinZodIssueMessages } from "#src/zod-issue-messages.js";
import { markdownWithCompleteFrontmatterSchema, stripFrontmatter } from "./skill-text.js";

const textEncoder = new TextEncoder();

const createRulePlanError = (issue: string): Error => new Error(`Cannot plan rule files: ${issue}`);

const ruleFileAgentSchema = agentDefinitionSchema.extend({ target: agentTargetSchema.options[1] });

const ruleFileSkillSchema = z.strictObject({
  installedSkill: installedSkillSchema.describe("Catalog-owned installed skill identity used for the output filename."),
  markdown: markdownWithCompleteFrontmatterSchema
    .refine((markdown) => stripFrontmatter(markdown).trim().length > 0, {
      message: "Rule-file markdown requires a non-empty body after frontmatter.",
    })
    .describe("Exact installed SKILL.md text used to produce one native rule body."),
});

const previousRuleFileSchema = z.strictObject({
  path: relativePathSchema.describe("Exact rule path whose original state is retained for restoration."),
  previous: previousFileValueSchema.describe("Decoded original whole-file state retained across updates."),
});

const ruleFileRequestFieldsSchema = z.strictObject({
  agent: ruleFileAgentSchema.describe("Decoded agent whose target selects the native rule-file format."),
  skills: z
    .array(ruleFileSkillSchema)
    .refine((skills) => skills.length === new Set(skills.map((skill) => skill.installedSkill.id)).size, {
      message: "Installed rule-file skill IDs must be unique.",
    })
    .describe("Ordered installed skill markdown values rendered into separate rule files."),
  previousFiles: z
    .array(previousRuleFileSchema)
    .refine((files) => files.length === new Set(files.map((file) => file.path)).size, {
      message: "Previous rule-file paths must be unique.",
    })
    .describe("Exact original file state for every desired rule path, in skill order."),
});

type RuleFileRequestFields = z.infer<typeof ruleFileRequestFieldsSchema>;

const rulePath = (request: RuleFileRequestFields, skillId: string): string =>
  `${request.agent.target.directory}/${skillId}${request.agent.target.extension}`;

const exactPreviousFileIssues = (request: RuleFileRequestFields) => {
  const expectedPaths = request.skills.map((skill) => rulePath(request, skill.installedSkill.id));
  const previousPaths = request.previousFiles.map((file) => file.path);
  const mismatchIndex = expectedPaths.findIndex((path, index) => path !== previousPaths[index]);
  const isPathListExact = mismatchIndex < 0 && expectedPaths.length === previousPaths.length;
  if (isPathListExact) {
    return [];
  }

  const shorterLength = Math.min(expectedPaths.length, previousPaths.length);
  const issueIndex = mismatchIndex < 0 ? shorterLength : mismatchIndex;

  return [
    {
      path: ["previousFiles", issueIndex],
      message: "Previous rule-file paths must exactly match desired rule paths in skill order.",
    },
  ];
};

export const ruleFileRequestSchema = ruleFileRequestFieldsSchema.superRefine((request, context) =>
  addZodIssueDetails(context, exactPreviousFileIssues(request)),
);

type RuleFileRequest = z.infer<typeof ruleFileRequestSchema>;

const ruleFileWriteSchema = z.strictObject({
  _tag: z.literal("write"),
  file: z.strictObject({
    owner: agentOwnerSchema,
    path: relativePathSchema,
    kind: fileKindSchema.options[2],
    ownership: wholeFileOwnershipSchema,
  }),
  bytes: writeOperationSchema.shape.bytes,
});

type RuleFileWrite = z.infer<typeof ruleFileWriteSchema>;

// Ordered desired rule writes, each with matching whole-file ownership.
export type RuleFilePlan = { writes: RuleFileWrite[] };

const createRuleWrite = (request: RuleFileRequest, skill: RuleFileRequest["skills"][number]): RuleFileWrite => {
  const path = rulePath(request, skill.installedSkill.id);
  const previousFile = request.previousFiles.find((file) => file.path === path);
  if (previousFile == null) {
    throw createRulePlanError(`Missing previous-file state for desired rule file ${path}.`);
  }

  const bytes = textEncoder.encode(stripFrontmatter(skill.markdown));

  return {
    _tag: "write",
    file: {
      path,
      kind: { _tag: "rule" },
      owner: { _tag: "agent", agentIds: [request.agent.id] },
      ownership: { _tag: "wholeFile", installedHash: hashBytes(bytes), previous: previousFile.previous },
    },
    bytes,
  };
};

// Plan native rule files without I/O: one whole-file write per skill.
export const planRuleFiles = (candidateRequest: unknown): RuleFilePlan => {
  const requestCheck = ruleFileRequestSchema.safeParse(candidateRequest);
  const isRequestAccepted = requestCheck.success;
  if (isRequestAccepted) {
    const request = requestCheck.data;

    return { writes: request.skills.map((skill) => createRuleWrite(request, skill)) };
  }

  throw createRulePlanError(joinZodIssueMessages(requestCheck.error));
};
