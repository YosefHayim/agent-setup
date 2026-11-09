import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  agentCatalog,
  agentCatalogSchema,
  agentDefinitionSchema,
  agentEvidenceSchema,
  agentTargetSchema,
  detectAgents,
  findAgent,
} from "./agent-catalog.js";

const expectedAgents = [
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
];

const validAgentFixture = {
  id: "example-agent",
  displayName: "Example Agent",
  detection: { homePaths: [".example"], absolutePaths: ["/Applications/Example.app"], commands: ["example"] },
  target: { _tag: "instructionFile", path: "EXAMPLE.md" },
  nativeHooks: { _tag: "unsupported" },
};

const decodeStrict =
  <Value, Encoded>(schema: Schema.Schema<Value, Encoded>) =>
  (input: unknown) =>
    Schema.decodeUnknownEither(schema, { onExcessProperty: "error" })(input);

const decodeDefinition = decodeStrict(agentDefinitionSchema);

const decodeTarget = decodeStrict(agentTargetSchema);

describe("agentCatalog", () => {
  it("decodes the exact approved agents in stable display order", () => {
    expect(agentCatalog).toEqual(expectedAgents);
  });

  it("finds agents with Option and represents absence", () => {
    expect(Option.map(findAgent("kimi-code"), (agent) => agent.displayName)).toEqual(Option.some("Kimi Code CLI"));
    expect(findAgent("missing-agent")).toEqual(Option.none());
  });
});

describe("agentCatalogSchema", () => {
  it("accepts a complete definition and rejects duplicate IDs", () => {
    expect(Either.isRight(decodeDefinition(validAgentFixture))).toBe(true);

    const agentCatalogCheck = decodeStrict(agentCatalogSchema)([
      validAgentFixture,
      { ...validAgentFixture, displayName: "Duplicate Agent" },
    ]);

    expect(Either.isLeft(agentCatalogCheck)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(agentCatalogCheck)))).toContain("Agent IDs must be unique");
  });

  it.each([
    {
      name: "agent definitions",
      input: { ...validAgentFixture, unexpected: true },
      decode: decodeDefinition,
    },
    {
      name: "agent detection",
      input: { ...validAgentFixture, detection: { ...validAgentFixture.detection, unexpected: true } },
      decode: decodeDefinition,
    },
    {
      name: "skill-directory targets",
      input: { _tag: "skillDirectory", path: ".example/skills", unexpected: true },
      decode: decodeTarget,
    },
    {
      name: "rule-file targets",
      input: { _tag: "ruleFile", directory: ".example/rules", extension: ".mdc", unexpected: true },
      decode: decodeTarget,
    },
    {
      name: "instruction-file targets",
      input: { _tag: "instructionFile", path: "EXAMPLE.md", unexpected: true },
      decode: decodeTarget,
    },
    {
      name: "instruction-link targets",
      input: {
        _tag: "instructionLink",
        instructionPath: "EXAMPLE.md",
        configPath: ".example/config.json",
        referenceFormat: "jsonRulesArray",
        unexpected: true,
      },
      decode: decodeTarget,
    },
  ])("rejects excess properties in $name", ({ input, decode }) => {
    const agentCatalogCheck = decode(input);

    expect(Either.isLeft(agentCatalogCheck)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(agentCatalogCheck)))).toContain("is unexpected");
  });

  it.each([
    { homePaths: [], absolutePaths: [] },
    { homePaths: [], commands: [] },
    { absolutePaths: [], commands: [] },
  ])("requires all three explicit detection arrays (%o)", (evidence) => {
    expect(Either.isLeft(decodeStrict(agentEvidenceSchema)(evidence))).toBe(true);
  });
});

describe("detectAgents", () => {
  it("uses OR semantics across every evidence kind and preserves catalog order", () => {
    const detected = detectAgents({
      homePaths: [".continue", ".claude"],
      absolutePaths: ["/Applications/Windsurf.app"],
      commands: ["gemini", "cursor", "grok"],
    });

    expect(detected.filter((agent) => agent.installed).map((agent) => agent.id)).toEqual([
      "claude-code",
      "cursor",
      "windsurf",
      "grok",
      "gemini",
      "continue",
    ]);
    expect(detected.map((agent) => agent.id)).toEqual(agentCatalog.map((agent) => agent.id));
  });

  it("returns every agent as not installed for empty evidence", () => {
    const detected = detectAgents({ homePaths: [], absolutePaths: [], commands: [] });

    expect(detected).toHaveLength(agentCatalog.length);
    expect(detected.every((agent) => !agent.installed)).toBe(true);
  });

  it("derives display names from the catalog without a redundant supported flag", () => {
    const detected = detectAgents({ homePaths: [], absolutePaths: [], commands: ["aider"] });

    expect(detected.map((agent) => agent.displayName)).toEqual(agentCatalog.map((agent) => agent.displayName));
    expect(detected.find((agent) => agent.id === "aider")).toEqual({
      id: "aider",
      displayName: "Aider",
      installed: true,
    });
    expect(detected.every((agent) => !("supported" in agent))).toBe(true);
  });
});
