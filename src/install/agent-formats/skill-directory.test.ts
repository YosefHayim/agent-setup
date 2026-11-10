import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { findAgent } from "#src/catalog/agent-catalog.js";
import { featureCatalog, findFeature } from "#src/catalog/feature-catalog.js";
import type { PreviousFileValue } from "#src/install/ownership.js";
import { planSkillDirectory, type SkillDirectoryPlan } from "./skill-directory.js";

const textEncoder = new TextEncoder();
const claudeAgent = findAgent("claude-code")!;
const writeReadmeFeature = findFeature("write-readme")!;
const missingPrevious: PreviousFileValue = { _tag: "missing" };
const priorSkillBytes = textEncoder.encode("previous skill\n");
const skillDefinition = writeReadmeFeature.installedSkill;
const skillPath = ".claude/skills/write-readme/SKILL.md";
const guidePath = ".claude/skills/write-readme/references/nested/guide.md";
const binaryPath = ".claude/skills/write-readme/references/logo.bin";
const plainPath = ".claude/skills/write-readme/references/plain.txt";
const plainBytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x6b, 0x65, 0x65, 0x70, 0x0d, 0x0a]);

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const sourceFiles = () => [
  { path: "SKILL.md", bytes: textEncoder.encode("Run `status` now.\n") },
  { path: "references/nested/guide.md", bytes: textEncoder.encode("Use the guide with care.\n") },
  { path: "references/logo.bin", bytes: Uint8Array.from([0xff, 0x40, 0x40, 0x43, 0x54, 0x4c, 0x40, 0x40]) },
  { path: "references/plain.txt", bytes: plainBytes },
  { path: "PRIVATE.md", bytes: textEncoder.encode("do not ship\n") },
  { path: "reference/sibling.md", bytes: textEncoder.encode("not under references\n") },
];

const previousFiles = () => [
  { path: skillPath, previous: { _tag: "priorFile", bytes: priorSkillBytes } },
  { path: guidePath, previous: missingPrevious },
  { path: binaryPath, previous: missingPrevious },
  { path: plainPath, previous: missingPrevious },
];

const request = () => ({
  agent: claudeAgent,
  skills: [{ installedSkill: skillDefinition, sourceFiles: sourceFiles() }],
  previousFiles: previousFiles(),
});

const writeAt = (plan: SkillDirectoryPlan, path: string) => {
  const write = plan.writes.find((candidate) => candidate.file.path === path);
  const isThereNoWrite = write == null;
  if (isThereNoWrite) {
    throw new Error(`No planned write at ${path}.`);
  }

  return write;
};

const errorMessage = (input: unknown): string => {
  try {
    planSkillDirectory(input);
  } catch (error) {
    return String(error);
  }

  throw new Error("Expected skill-directory planning to fail.");
};

describe("planSkillDirectory", () => {
  it("copies only exact shipped paths and every file below an allowed directory", () => {
    const plan = planSkillDirectory(request());

    expect(plan.writes.map((write) => write.file.path)).toEqual([skillPath, binaryPath, guidePath, plainPath]);
    expect(plan.writes.some((write) => write.file.path.includes("PRIVATE"))).toBe(false);
    expect(plan.writes.some((write) => write.file.path.includes("reference/sibling"))).toBe(false);
  });

  it("copies every catalog allowlist exactly without accepting sibling prefixes", () => {
    const skills = featureCatalog.flatMap((feature) => {
      if (feature.installedSkill._tag === "none") {
        return [];
      }

      const sourceSnapshot = feature.installedSkill.shippedPaths.flatMap((shippedPath, index) => {
        const preparedPath = /\.[^/]+$/.test(shippedPath) ? shippedPath : `${shippedPath}/nested/allowed.txt`;

        return [
          { path: preparedPath, bytes: textEncoder.encode(`allowed ${index}\n`) },
          { path: `${shippedPath}-sibling/ignored.txt`, bytes: textEncoder.encode(`ignored ${index}\n`) },
        ];
      });

      return [{ installedSkill: feature.installedSkill, sourceFiles: sourceSnapshot }];
    });
    const expectedPaths = skills.flatMap((skill) =>
      skill.sourceFiles
        .filter((file) => !file.path.includes("-sibling/"))
        .map((file) => `.claude/skills/${skill.installedSkill.id}/${file.path}`)
        .sort(),
    );
    const catalogRequest = {
      agent: claudeAgent,
      skills,
      previousFiles: expectedPaths.map((path) => ({ path, previous: missingPrevious })),
    };

    const plan = planSkillDirectory(catalogRequest);

    expect(plan.writes.map((write) => write.file.path)).toEqual(expectedPaths);
  });

  it("returns whole-file ownership with matching hashes and exact previous states", () => {
    const plan = planSkillDirectory(request());
    const skillWrite = writeAt(plan, skillPath);

    expect(skillWrite.file).toMatchObject({
      owner: { _tag: "agent", agentIds: ["claude-code"] },
      path: skillPath,
      kind: { _tag: "skill" },
      ownership: {
        _tag: "wholeFile",
        previous: { _tag: "priorFile", bytes: priorSkillBytes },
      },
    });
    expect(skillWrite.file.ownership.installedHash).toBe(hashBytes(skillWrite.bytes));
  });

  it("rejects missing allowlist roots and incomplete or extra previous-file evidence", () => {
    const missingAllowlist = request();
    missingAllowlist.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: sourceFiles().filter((file) => !file.path.startsWith("references/")),
    };
    const missingPrevious = request();
    missingPrevious.previousFiles = previousFiles().filter((file) => file.path !== guidePath);
    const extraPrevious = request();
    extraPrevious.previousFiles = [
      ...previousFiles(),
      { path: ".claude/skills/write-readme/undeclared.md", previous: { _tag: "missing" } },
    ];

    expect(errorMessage(missingAllowlist)).toContain("Shipped path references");
    expect(errorMessage(missingPrevious)).toContain("requires one exact previous-file state");
    expect(errorMessage(extraPrevious)).toContain("does not belong to a desired skill file");
  });

  it("rejects a shipped file prepared as a directory", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: sourceFiles().map((file) =>
        file.path === "SKILL.md" ? { path: "SKILL.md/evil", bytes: textEncoder.encode("not a directory\n") } : file,
      ),
    };
    invalidRequest.previousFiles = previousFiles().map((file) =>
      file.path === skillPath ? { path: ".claude/skills/write-readme/SKILL.md/evil", previous: missingPrevious } : file,
    );

    expect(errorMessage(invalidRequest)).toContain("file path");
  });

  it("rejects case-insensitive prepared-path collisions", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [...sourceFiles(), { path: "skill.md", bytes: textEncoder.encode("collision\n") }],
    };

    expect(errorMessage(invalidRequest)).toContain("case-insensitive");
  });

  it.each(["references", "REFERENCES"])("rejects an impossible parent file %s beside its descendants", (parentPath) => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [...sourceFiles(), { path: parentPath, bytes: textEncoder.encode("parent file\n") }],
    };
    invalidRequest.previousFiles = [
      ...previousFiles(),
      { path: `.claude/skills/write-readme/${parentPath}`, previous: missingPrevious },
    ];

    expect(errorMessage(invalidRequest)).toContain("file and directory");
  });

  it("rejects a shipped directory root prepared as one file", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [
        { path: "SKILL.md", bytes: textEncoder.encode("skill\n") },
        { path: "references", bytes: textEncoder.encode("not a directory\n") },
      ],
    };
    invalidRequest.previousFiles = [
      { path: skillPath, previous: { _tag: "priorFile", bytes: priorSkillBytes } },
      { path: ".claude/skills/write-readme/references", previous: missingPrevious },
    ];

    expect(errorMessage(invalidRequest)).toContain("directory root");
  });

  it("strictly rejects unknown request properties", () => {
    expect(() => planSkillDirectory({ ...request(), unexpected: true })).toThrow();
  });
});
