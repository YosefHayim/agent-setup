import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { findAgent } from "#src/catalog/agent-catalog.js";
import { featureCatalog, findFeature } from "#src/catalog/feature-catalog.js";
import type { PreviousFileValue } from "#src/install/ownership.js";
import { planSkillDirectory, type SkillDirectoryPlan } from "./skill-directory.js";

const stringEncoder = new TextEncoder();
const claudeAgent = findAgent("claude-code")!;
const writeReadmeFeature = findFeature("write-readme")!;
const missingPrevious: PreviousFileValue = { _tag: "missing" };
const priorSkillBytes = stringEncoder.encode("previous skill\n");
const skillDefinition = writeReadmeFeature.installedSkill;
const skillPath = ".claude/skills/write-readme/SKILL.md";
const guidePath = ".claude/skills/write-readme/references/nested/guide.md";
const binaryPath = ".claude/skills/write-readme/references/logo.bin";
const plainPath = ".claude/skills/write-readme/references/plain.txt";
const plainBytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x6b, 0x65, 0x65, 0x70, 0x0d, 0x0a]);

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const createOriginFiles = () => [
  { path: "SKILL.md", bytes: stringEncoder.encode("Run `status` now.\n") },
  { path: "references/nested/guide.md", bytes: stringEncoder.encode("Use the guide with care.\n") },
  { path: "references/logo.bin", bytes: Uint8Array.from([0xff, 0x40, 0x40, 0x43, 0x54, 0x4c, 0x40, 0x40]) },
  { path: "references/plain.txt", bytes: plainBytes },
  { path: "PRIVATE.md", bytes: stringEncoder.encode("do not ship\n") },
  { path: "reference/sibling.md", bytes: stringEncoder.encode("not under references\n") },
];

const createPreviousFiles = () => [
  { path: skillPath, previous: { _tag: "priorFile", bytes: priorSkillBytes } },
  { path: guidePath, previous: missingPrevious },
  { path: binaryPath, previous: missingPrevious },
  { path: plainPath, previous: missingPrevious },
];

const request = () => ({
  agent: claudeAgent,
  skills: [{ installedSkill: skillDefinition, sourceFiles: createOriginFiles() }],
  previousFiles: createPreviousFiles(),
});

const writeAt = (plan: SkillDirectoryPlan, path: string) => {
  const write = plan.writes.find((candidate) => candidate.file.path === path);

  const isThereNoWrite = write == null;
  if (isThereNoWrite) {
    throw new Error(`No planned write at ${path}.`);
  }

  return write;
};

const findErrorMessage = (uncheckedRequest: unknown): string => {
  try {
    planSkillDirectory(uncheckedRequest);
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
      const installedSkill = feature.installedSkill;
      const isInstalledSkillNone = installedSkill._tag === "none";
      if (isInstalledSkillNone) {
        return [];
      }

      const authoredSnapshot = installedSkill.shippedPaths.flatMap((shippedPath, index) => {
        const hasFileExtension = /\.[^/]+$/.test(shippedPath);
        const preparedPath = hasFileExtension ? shippedPath : `${shippedPath}/nested/allowed.txt`;

        return [
          { path: preparedPath, bytes: stringEncoder.encode(`allowed ${index}\n`) },
          { path: `${shippedPath}-sibling/ignored.txt`, bytes: stringEncoder.encode(`ignored ${index}\n`) },
        ];
      });

      return [{ installedSkill, sourceFiles: authoredSnapshot }];
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
      sourceFiles: createOriginFiles().filter((file) => !file.path.startsWith("references/")),
    };
    const missingPrevious = request();
    missingPrevious.previousFiles = createPreviousFiles().filter((file) => file.path !== guidePath);
    const extraPrevious = request();
    extraPrevious.previousFiles = [
      ...createPreviousFiles(),
      { path: ".claude/skills/write-readme/undeclared.md", previous: { _tag: "missing" } },
    ];

    expect(findErrorMessage(missingAllowlist)).toContain("Shipped path references");
    expect(findErrorMessage(missingPrevious)).toContain("requires one exact previous-file state");
    expect(findErrorMessage(extraPrevious)).toContain("does not belong to a desired skill file");
  });

  it("rejects a shipped file prepared as a directory", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: createOriginFiles().map((file) => {
        const isSkillMarkdown = file.path === "SKILL.md";
        return isSkillMarkdown ? { path: "SKILL.md/evil", bytes: stringEncoder.encode("not a directory\n") } : file;
      }),
    };
    invalidRequest.previousFiles = createPreviousFiles().map((file) => {
      const isSkillPath = file.path === skillPath;
      return isSkillPath ? { path: ".claude/skills/write-readme/SKILL.md/evil", previous: missingPrevious } : file;
    });

    expect(findErrorMessage(invalidRequest)).toContain("file path");
  });

  it("rejects case-insensitive prepared-path collisions", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [...createOriginFiles(), { path: "skill.md", bytes: stringEncoder.encode("collision\n") }],
    };

    expect(findErrorMessage(invalidRequest)).toContain("case-insensitive");
  });

  it.each(["references", "REFERENCES"])("rejects an impossible parent file %s beside its descendants", (parentPath) => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [...createOriginFiles(), { path: parentPath, bytes: stringEncoder.encode("parent file\n") }],
    };
    invalidRequest.previousFiles = [
      ...createPreviousFiles(),
      { path: `.claude/skills/write-readme/${parentPath}`, previous: missingPrevious },
    ];

    expect(findErrorMessage(invalidRequest)).toContain("file and directory");
  });

  it("rejects a shipped directory root prepared as one file", () => {
    const invalidRequest = request();
    invalidRequest.skills[0] = {
      installedSkill: skillDefinition,
      sourceFiles: [
        { path: "SKILL.md", bytes: stringEncoder.encode("skill\n") },
        { path: "references", bytes: stringEncoder.encode("not a directory\n") },
      ],
    };
    invalidRequest.previousFiles = [
      { path: skillPath, previous: { _tag: "priorFile", bytes: priorSkillBytes } },
      { path: ".claude/skills/write-readme/references", previous: missingPrevious },
    ];

    expect(findErrorMessage(invalidRequest)).toContain("directory root");
  });

  it("strictly rejects unknown request properties", () => {
    expect(() => planSkillDirectory({ ...request(), unexpected: true })).toThrow();
  });
});
