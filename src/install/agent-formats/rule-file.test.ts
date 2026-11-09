import { createHash } from "node:crypto";

import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { findAgent } from "../../catalog/agent-catalog.js";
import { findFeature } from "../../catalog/feature-catalog.js";
import { planRuleFiles, ruleFileRequestSchema } from "./rule-file.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const cursor = findAgent("cursor")!;
const missingPrevious = { _tag: "missing" };
const priorBytes = textEncoder.encode("user-authored rule\n");
const priorFile = { _tag: "priorFile", bytes: priorBytes };

const installedSkillFor = (featureId: string) => {
  const feature = findFeature(featureId)!;
  if (feature.installedSkill._tag !== "skill") {
    throw new Error(`Feature ${featureId} does not install a skill.`);
  }

  return feature.installedSkill;
};

const makeCodeReadableSkill = installedSkillFor("make-code-readable");
const imageToCodeSkill = installedSkillFor("image-to-code");

const ruleFileRequest = {
  agent: cursor,
  skills: [
    {
      installedSkill: makeCodeReadableSkill,
      markdown: "---\nname: make-code-readable\ndescription: Make code readable.\n---\nStart with a plain step.\n",
    },
    {
      installedSkill: imageToCodeSkill,
      markdown: "Convert a PNG.\n\n---\nThis divider is body content.\n",
    },
  ],
  previousFiles: [
    { path: ".cursor/rules/make-code-readable.mdc", previous: missingPrevious },
    { path: ".cursor/rules/image-to-code.mdc", previous: priorFile },
  ],
};

const unwrap = <Right, Left>(ruleMerge: Either.Either<Right, Left>): Right =>
  Either.getOrThrowWith(ruleMerge, (error) => new Error(String(error)));

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const writeAt = <Write>(plan: { writes: ReadonlyArray<Write> }, index: number): Write =>
  Option.getOrThrow(Option.fromNullable(plan.writes.at(index)));

describe("planRuleFiles", () => {
  it("plans one ordered rule write per installed skill with exact ownership", () => {
    const plan = unwrap(planRuleFiles(ruleFileRequest));

    expect(plan.writes.map((write) => write.file.path)).toEqual([
      ".cursor/rules/make-code-readable.mdc",
      ".cursor/rules/image-to-code.mdc",
    ]);
    expect(plan.writes.map((write) => textDecoder.decode(write.bytes))).toEqual([
      "Start with a plain step.\n",
      "Convert a PNG.\n\n---\nThis divider is body content.\n",
    ]);

    const firstWrite = writeAt(plan, 0);
    const secondWrite = writeAt(plan, 1);

    expect(firstWrite.file.kind).toEqual({ _tag: "rule" });
    expect(firstWrite.file.owner).toEqual({ _tag: "agent", agentIds: ["cursor"] });
    expect(firstWrite.file.ownership).toEqual({
      _tag: "wholeFile",
      installedHash: hashBytes(firstWrite.bytes),
      previous: missingPrevious,
    });
    expect(secondWrite.file.ownership).toEqual({
      _tag: "wholeFile",
      installedHash: hashBytes(secondWrite.bytes),
      previous: priorFile,
    });
  });

  it("strips CRLF frontmatter without trimming the markdown body", () => {
    const request = {
      ...ruleFileRequest,
      skills: [
        {
          installedSkill: makeCodeReadableSkill,
          markdown: "---\r\nname: make-code-readable\r\n---\r\n\r\n  Run the steps.\r\n",
        },
      ],
      previousFiles: [{ path: ".cursor/rules/make-code-readable.mdc", previous: missingPrevious }],
    };

    const plan = unwrap(planRuleFiles(request));
    const write = writeAt(plan, 0);

    expect(textDecoder.decode(write.bytes)).toBe("\r\n  Run the steps.\r\n");
  });

  it.each([
    {
      name: "an unterminated leading frontmatter block",
      request: {
        ...ruleFileRequest,
        skills: [
          {
            installedSkill: makeCodeReadableSkill,
            markdown: "---\nname: make-code-readable\nNo closing delimiter.\n",
          },
        ],
        previousFiles: [{ path: ".cursor/rules/make-code-readable.mdc", previous: missingPrevious }],
      },
      issue: "frontmatter",
    },
    {
      name: "a frontmatter-only markdown body",
      request: {
        ...ruleFileRequest,
        skills: [
          {
            installedSkill: makeCodeReadableSkill,
            markdown: "---\nname: make-code-readable\n---\n",
          },
        ],
        previousFiles: [{ path: ".cursor/rules/make-code-readable.mdc", previous: missingPrevious }],
      },
      issue: "body",
    },
    {
      name: "duplicate installed skill IDs",
      request: {
        ...ruleFileRequest,
        skills: [ruleFileRequest.skills[0], ruleFileRequest.skills[0]],
        previousFiles: [ruleFileRequest.previousFiles[0], ruleFileRequest.previousFiles[0]],
      },
      issue: "unique",
    },
    {
      name: "duplicate previous-file paths",
      request: {
        ...ruleFileRequest,
        previousFiles: [ruleFileRequest.previousFiles[0], ruleFileRequest.previousFiles[0]],
      },
      issue: "unique",
    },
    {
      name: "a missing previous-file state",
      request: { ...ruleFileRequest, previousFiles: ruleFileRequest.previousFiles.slice(0, 1) },
      issue: "exactly match",
    },
    {
      name: "an extra previous-file state",
      request: {
        ...ruleFileRequest,
        previousFiles: [
          ...ruleFileRequest.previousFiles,
          { path: ".cursor/rules/extra.mdc", previous: missingPrevious },
        ],
      },
      issue: "exactly match",
    },
    {
      name: "a non-rule-file target",
      request: {
        ...ruleFileRequest,
        agent: { ...cursor, target: { _tag: "instructionFile", path: "AGENTS.md" } },
      },
      issue: "ruleFile",
    },
    {
      name: "an unknown request property",
      request: { ...ruleFileRequest, unexpected: true },
      issue: "unexpected",
    },
  ])("rejects $name", ({ request, issue }) => {
    const ruleMerge = planRuleFiles(request);

    expect(Either.isLeft(ruleMerge)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(ruleMerge)))).toContain(issue);
  });

  it("strictly rejects unknown nested request properties", () => {
    const ruleMerge = Schema.decodeUnknownEither(ruleFileRequestSchema, {
      onExcessProperty: "error",
    })({
      ...ruleFileRequest,
      skills: [{ ...ruleFileRequest.skills[0], unexpected: true }],
    });

    expect(Either.isLeft(ruleMerge)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(ruleMerge)))).toContain("unexpected");
  });
});
