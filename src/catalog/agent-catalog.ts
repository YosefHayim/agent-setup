import { Option, Schema } from "effect";

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

export const agentIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(AGENT_ID_PATTERN, {
    message: () => "Agent IDs must use lowercase kebab-case.",
  }),
  Schema.brand("AgentId"),
  Schema.annotations({
    description: "Stable public agent ID.",
  }),
);

const homePathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(HOME_RELATIVE_PATH_PATTERN, {
    message: () => "Home paths must be relative and stay inside the home directory.",
  }),
  Schema.annotations({
    description: "Home-relative path whose presence detects an agent.",
  }),
);

const absolutePathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(ABSOLUTE_PATH_PATTERN, {
    message: () => "Absolute detection paths must start at the filesystem root and contain no parent traversal.",
  }),
  Schema.annotations({
    description: "Absolute path whose presence detects an agent.",
  }),
);

const commandSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(COMMAND_NAME_PATTERN, {
    message: () => "Detection commands must be executable names without paths or whitespace.",
  }),
  Schema.annotations({
    description: "Executable name whose availability detects an agent.",
  }),
);

const uniqueList = <Value, Encoded>(request: {
  readonly item: Schema.Schema<Value, Encoded>;
  readonly duplicateMessage: string;
  readonly description: string;
}) =>
  Schema.Array(request.item).pipe(
    Schema.filter((values) => values.length === new Set(values).size, { message: () => request.duplicateMessage }),
    Schema.annotations({ description: request.description }),
  );

const agentDetectionSchema = Schema.Struct({
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
}).annotations({
  description: "Observable evidence that can detect an installed agent.",
});

const targetPathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(HOME_RELATIVE_PATH_PATTERN, {
    message: () => "Agent target paths must be relative and stay inside the destination root.",
  }),
  Schema.annotations({
    description: "Destination-relative agent output path.",
  }),
);

const ruleExtensionSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(RULE_EXTENSION_PATTERN, {
    message: () => "Rule-file extensions must start with a dot and use lowercase letters or digits.",
  }),
  Schema.annotations({
    description: "Extension used for one generated rule file per skill.",
  }),
);

export const agentTargetSchema = Schema.Union(
  Schema.TaggedStruct("skillDirectory", {
    path: targetPathSchema.annotations({
      description: "Directory that receives installed skill directories.",
    }),
  }),
  Schema.TaggedStruct("ruleFile", {
    directory: targetPathSchema.annotations({
      description: "Directory that receives one native rule file per skill.",
    }),
    extension: ruleExtensionSchema.annotations({
      description: "Native rule-file extension appended to each skill ID.",
    }),
  }),
  Schema.TaggedStruct("instructionFile", {
    path: targetPathSchema.annotations({
      description: "Instruction file that receives one managed block.",
    }),
  }),
  Schema.TaggedStruct("instructionLink", {
    instructionPath: targetPathSchema.annotations({
      description: "Managed instruction file referenced from native agent configuration.",
    }),
    configPath: targetPathSchema.annotations({
      description: "Native configuration file that stores the instruction reference.",
    }),
    referenceFormat: Schema.Literal("yamlReadArray", "jsonRulesArray").annotations({
      description: "Native configuration structure used to reference the instruction file.",
    }),
  }),
).annotations({
  description: "Exactly one native output format and destination for an agent.",
});

const nativeHookAdapterSchema = Schema.Union(
  Schema.TaggedStruct("unsupported", {}),
  Schema.TaggedStruct("claudeJson", { configPath: targetPathSchema }),
  Schema.TaggedStruct("codexJson", { configPath: targetPathSchema }),
  Schema.TaggedStruct("grokJson", { configPath: targetPathSchema }),
).annotations({
  description: "Verified native lifecycle-hook format or an explicit unsupported result.",
});

export const agentDefinitionSchema = Schema.Struct({
  id: agentIdSchema.annotations({
    description: "Stable public agent ID.",
  }),
  displayName: Schema.NonEmptyTrimmedString.annotations({
    description: "Human-facing agent name shown in CLI output.",
  }),
  detection: agentDetectionSchema.annotations({
    description: "Explicit evidence alternatives used to detect the agent.",
  }),
  target: agentTargetSchema.annotations({
    description: "Single native output target selected by its format tag.",
  }),
  nativeHooks: nativeHookAdapterSchema,
});

export type AgentDefinition = Schema.Schema.Type<typeof agentDefinitionSchema>;

const duplicateAgentIdIssues = (agents: ReadonlyArray<AgentDefinition>) =>
  agents.flatMap((agent, index) =>
    agents.findIndex((candidate) => candidate.id === agent.id) === index
      ? []
      : [{ path: [index, "id"], message: "Agent IDs must be unique." }],
  );

export const agentCatalogSchema = Schema.Array(agentDefinitionSchema).pipe(Schema.filter(duplicateAgentIdIssues));

export const agentCatalog = Schema.decodeUnknownSync(agentCatalogSchema, { onExcessProperty: "error" })([
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

export const agentEvidenceSchema = Schema.Struct({
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
}).annotations({
  description: "Filesystem and command evidence already observed by an external detector.",
});

export type AgentEvidence = Schema.Schema.Type<typeof agentEvidenceSchema>;

const hasObservedEvidence = (declared: ReadonlyArray<string>, observed: ReadonlyArray<string>): boolean =>
  declared.some((value) => observed.includes(value));

const isAgentInstalled = (agent: AgentDefinition, evidence: AgentEvidence): boolean =>
  hasObservedEvidence(agent.detection.homePaths, evidence.homePaths) ||
  hasObservedEvidence(agent.detection.absolutePaths, evidence.absolutePaths) ||
  hasObservedEvidence(agent.detection.commands, evidence.commands);

export const findAgent = (id: string) => Option.fromNullable(agentCatalog.find((agent) => agent.id === id));

export const detectAgents = (evidence: AgentEvidence) =>
  agentCatalog.map((agent) => ({
    id: agent.id,
    displayName: agent.displayName,
    installed: isAgentInstalled(agent, evidence),
  }));
