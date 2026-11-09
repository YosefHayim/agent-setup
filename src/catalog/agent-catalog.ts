import { z } from "zod";

import { nonEmptyTrimmedTextSchema } from "../install/text-rules.js";

// e.g. "claude-code", "cursor" — not "ClaudeCode" or "claude_code"
const AGENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// e.g. ".claude/settings.json" — not "/abs" or "a/../b"
const HOME_RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/;
// e.g. "/usr/local/bin/code" — absolute, no ".." segments
const ABSOLUTE_PATH_PATTERN = /^\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/;
// e.g. "claude", "code" — bare executable name, no path or spaces
const COMMAND_NAME_PATTERN = /^[^/\\\s]+$/;
// e.g. ".md", ".mdc" — leading-dot lowercase extension
const RULE_EXTENSION_PATTERN = /^\.[a-z0-9]+$/;

export const agentIdSchema = nonEmptyTrimmedTextSchema
  .regex(AGENT_ID_PATTERN, "Agent IDs must use lowercase kebab-case.")
  .brand<"AgentId">()
  .describe("Stable public agent ID.");

const homePathSchema = nonEmptyTrimmedTextSchema
  .regex(HOME_RELATIVE_PATH_PATTERN, "Home paths must be relative and stay inside the home directory.")
  .describe("Home-relative path whose presence detects an agent.");

const absolutePathSchema = nonEmptyTrimmedTextSchema
  .regex(
    ABSOLUTE_PATH_PATTERN,
    "Absolute detection paths must start at the filesystem root and contain no parent traversal.",
  )
  .describe("Absolute path whose presence detects an agent.");

const commandSchema = nonEmptyTrimmedTextSchema
  .regex(COMMAND_NAME_PATTERN, "Detection commands must be executable names without paths or whitespace.")
  .describe("Executable name whose availability detects an agent.");

const uniqueList = <Item extends z.ZodType>(request: {
  readonly item: Item;
  readonly duplicateMessage: string;
  readonly description: string;
}) =>
  z
    .array(request.item)
    .refine((values) => values.length === new Set(values).size, { message: request.duplicateMessage })
    .describe(request.description);

const agentDetectionSchema = z
  .strictObject({
    homePaths: uniqueList({
      item: homePathSchema,
      duplicateMessage: "Home detection paths must be unique for one agent.",
      description: "Explicit home-relative detection paths, matched with OR semantics.",
    }),
    absolutePaths: uniqueList({
      item: absolutePathSchema,
      duplicateMessage: "Absolute detection paths must be unique for one agent.",
      description: "Explicit absolute detection paths, matched with OR semantics.",
    }),
    commands: uniqueList({
      item: commandSchema,
      duplicateMessage: "Detection commands must be unique for one agent.",
      description: "Explicit command names, matched with OR semantics.",
    }),
  })
  .describe("Observable evidence that can detect an installed agent.");

const targetPathSchema = nonEmptyTrimmedTextSchema
  .regex(HOME_RELATIVE_PATH_PATTERN, "Agent target paths must be relative and stay inside the destination root.")
  .describe("Destination-relative agent output path.");

const ruleExtensionSchema = nonEmptyTrimmedTextSchema
  .regex(RULE_EXTENSION_PATTERN, "Rule-file extensions must start with a dot and use lowercase letters or digits.")
  .describe("Extension used for one generated rule file per skill.");

export const agentTargetSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({
      _tag: z.literal("skillDirectory"),
      path: targetPathSchema.describe("Directory that receives installed skill directories."),
    }),
    z.strictObject({
      _tag: z.literal("ruleFile"),
      directory: targetPathSchema.describe("Directory that receives one native rule file per skill."),
      extension: ruleExtensionSchema.describe("Native rule-file extension appended to each skill ID."),
    }),
    z.strictObject({
      _tag: z.literal("instructionFile"),
      path: targetPathSchema.describe("Instruction file that receives one managed block."),
    }),
    z.strictObject({
      _tag: z.literal("instructionLink"),
      instructionPath: targetPathSchema.describe(
        "Managed instruction file referenced from native agent configuration.",
      ),
      configPath: targetPathSchema.describe("Native configuration file that stores the instruction reference."),
      referenceFormat: z
        .enum(["yamlReadArray", "jsonRulesArray"])
        .describe("Native configuration structure used to reference the instruction file."),
    }),
  ])
  .describe("Exactly one native output format and destination for an agent.");

const nativeHookAdapterSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("unsupported") }),
    z.strictObject({ _tag: z.literal("claudeJson"), configPath: targetPathSchema }),
    z.strictObject({ _tag: z.literal("codexJson"), configPath: targetPathSchema }),
    z.strictObject({ _tag: z.literal("grokJson"), configPath: targetPathSchema }),
  ])
  .describe("Verified native lifecycle-hook format or an explicit unsupported result.");

export const agentDefinitionSchema = z.strictObject({
  id: agentIdSchema.describe("Stable public agent ID."),
  displayName: nonEmptyTrimmedTextSchema.describe("Human-facing agent name shown in CLI output."),
  detection: agentDetectionSchema.describe("Explicit evidence alternatives used to detect the agent."),
  target: agentTargetSchema.describe("Single native output target selected by its format tag."),
  nativeHooks: nativeHookAdapterSchema,
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

const duplicateAgentIdIssues = (agents: ReadonlyArray<AgentDefinition>) =>
  agents.flatMap((agent, index) =>
    agents.findIndex((candidate) => candidate.id === agent.id) === index
      ? []
      : [{ path: [index, "id"], message: "Agent IDs must be unique." }],
  );

export const agentCatalogSchema = z.array(agentDefinitionSchema).superRefine((agents, context) => {
  for (const issue of duplicateAgentIdIssues(agents)) {
    context.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  }
});

export const agentCatalog: ReadonlyArray<AgentDefinition> = agentCatalogSchema.parse([
  {
    id: "claude-code",
    displayName: "Claude Code",
    detection: { homePaths: [".claude"], absolutePaths: [], commands: ["claude"] },
    target: { _tag: "skillDirectory", path: ".claude/skills" },
    nativeHooks: { _tag: "claudeJson", configPath: ".claude/settings.json" },
  },
  {
    id: "kiro",
    displayName: "Kiro",
    detection: { homePaths: [".kiro"], absolutePaths: [], commands: ["kiro"] },
    target: { _tag: "skillDirectory", path: ".kiro/skills" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "kimi-code",
    displayName: "Kimi Code CLI",
    detection: { homePaths: [".kimi-code"], absolutePaths: [], commands: ["kimi"] },
    target: { _tag: "skillDirectory", path: ".kimi-code/skills" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "devin",
    displayName: "Devin CLI",
    detection: { homePaths: [".devin", ".config/devin"], absolutePaths: [], commands: ["devin"] },
    target: { _tag: "skillDirectory", path: ".devin/skills" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "cursor",
    displayName: "Cursor",
    detection: { homePaths: [".cursor"], absolutePaths: ["/Applications/Cursor.app"], commands: ["cursor"] },
    target: { _tag: "ruleFile", directory: ".cursor/rules", extension: ".mdc" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    detection: { homePaths: [".windsurf"], absolutePaths: ["/Applications/Windsurf.app"], commands: ["windsurf"] },
    target: { _tag: "instructionFile", path: ".windsurfrules" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "cline",
    displayName: "Cline",
    detection: { homePaths: [".cline"], absolutePaths: [], commands: ["cline"] },
    target: { _tag: "instructionFile", path: ".clinerules" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "codex",
    displayName: "Codex",
    detection: { homePaths: [".codex"], absolutePaths: [], commands: ["codex"] },
    target: { _tag: "skillDirectory", path: ".agents/skills" },
    nativeHooks: { _tag: "codexJson", configPath: ".codex/hooks.json" },
  },
  {
    id: "grok",
    displayName: "Grok",
    detection: { homePaths: [".grok"], absolutePaths: [], commands: ["grok"] },
    target: { _tag: "skillDirectory", path: ".grok/skills" },
    nativeHooks: { _tag: "grokJson", configPath: ".grok/hooks/agent-setup.json" },
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    detection: { homePaths: [], absolutePaths: [], commands: ["gemini"] },
    target: { _tag: "instructionFile", path: "GEMINI.md" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "aider",
    displayName: "Aider",
    detection: { homePaths: [], absolutePaths: [], commands: ["aider"] },
    target: {
      _tag: "instructionLink",
      instructionPath: "AGENTS.md",
      configPath: ".aider.conf.yml",
      referenceFormat: "yamlReadArray",
    },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "continue",
    displayName: "Continue",
    detection: { homePaths: [".continue"], absolutePaths: [], commands: [] },
    target: {
      _tag: "instructionLink",
      instructionPath: "AGENTS.md",
      configPath: ".continue/config.json",
      referenceFormat: "jsonRulesArray",
    },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "cody",
    displayName: "Cody",
    detection: { homePaths: [".cody"], absolutePaths: [], commands: [] },
    target: { _tag: "instructionFile", path: ".cody/instructions.md" },
    nativeHooks: { _tag: "unsupported" },
  },
  {
    id: "junie",
    displayName: "Junie",
    detection: { homePaths: [".junie"], absolutePaths: [], commands: [] },
    target: { _tag: "instructionFile", path: ".junie/guidelines.md" },
    nativeHooks: { _tag: "unsupported" },
  },
]);

export const agentEvidenceSchema = z
  .strictObject({
    homePaths: uniqueList({
      item: homePathSchema,
      duplicateMessage: "Observed home paths must be unique.",
      description: "Observed home-relative paths.",
    }),
    absolutePaths: uniqueList({
      item: absolutePathSchema,
      duplicateMessage: "Observed absolute paths must be unique.",
      description: "Observed absolute paths.",
    }),
    commands: uniqueList({
      item: commandSchema,
      duplicateMessage: "Observed commands must be unique.",
      description: "Observed executable names.",
    }),
  })
  .describe("Filesystem and command evidence already observed by an external detector.");

export type AgentEvidence = z.infer<typeof agentEvidenceSchema>;

const hasObservedEvidence = (declared: ReadonlyArray<string>, observed: ReadonlyArray<string>): boolean =>
  declared.some((value) => observed.includes(value));

const isAgentInstalled = (agent: AgentDefinition, evidence: AgentEvidence): boolean =>
  hasObservedEvidence(agent.detection.homePaths, evidence.homePaths) ||
  hasObservedEvidence(agent.detection.absolutePaths, evidence.absolutePaths) ||
  hasObservedEvidence(agent.detection.commands, evidence.commands);

export const findAgent = (id: string): AgentDefinition | null => agentCatalog.find((agent) => agent.id === id) ?? null;

export const detectAgents = (evidence: AgentEvidence) =>
  agentCatalog.map((agent) => ({
    id: agent.id,
    displayName: agent.displayName,
    installed: isAgentInstalled(agent, evidence),
  }));
