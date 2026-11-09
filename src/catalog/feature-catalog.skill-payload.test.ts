/**
 * Validation for every shipped skill referenced by the feature catalog. These
 * checks are cheap and catch the frontmatter mistakes that make Kimi or Kiro
 * silently skip a skill.
 *
 * Authored directories are kebab-case (`sourceDirectory`). Public installed
 * skill IDs (and SKILL.md `name`) remain kebab-case data.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { featureCatalog, skillsForFeatures } from "./feature-catalog.js";

type Frontmatter = {
  name?: string;
  description?: string;
  type?: string;
  "disable-model-invocation"?: boolean;
};

const parseFrontmatter = (file: string): { frontmatter: Frontmatter | null; body: string } => {
  const text = readFileSync(file, "utf8");
  // e.g. "---\nname: foo\n---\n# body" → groups: frontmatter block, body
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: text };
  const frontmatter: Frontmatter = parse(match[1]);
  return { frontmatter, body: match[2] };
};

const skillRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

const installedSkills = skillsForFeatures(featureCatalog.map((feature) => feature.id)).map((skill) => {
  const feature = featureCatalog.find(
    (candidate) => candidate.installedSkill._tag === "skill" && candidate.installedSkill.id === skill.id,
  );
  if (feature === undefined) {
    throw new Error(`Installed skill ${skill.id} is missing a catalog feature.`);
  }
  return {
    skillId: skill.id,
    sourceDirectory: feature.sourceDirectory,
    shippedPaths: skill.shippedPaths,
  };
});

const sourceSkillDirectories = readdirSync(skillRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) => existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

const flowSkills = sourceSkillDirectories.flatMap((sourceDirectory) => {
  const skillMd = path.join(skillRoot, sourceDirectory, "SKILL.md");
  const { frontmatter } = parseFrontmatter(skillMd);
  if (frontmatter?.type !== "flow" || frontmatter.name === undefined) return [];
  return [{ skillId: frontmatter.name, sourceDirectory }];
});

const expectValidSkillFrontmatter = (skillMd: string, expectedName: string): void => {
  expect(existsSync(skillMd)).toBe(true);

  const { frontmatter } = parseFrontmatter(skillMd);
  expect(frontmatter).not.toBeNull();
  expect(frontmatter?.name).toBe(expectedName);
  // e.g. "image-to-code", "make-code-readable" — not "ImageToCode"
  expect(frontmatter?.name).toMatch(/^[a-z0-9-]+$/);
  expect((frontmatter?.name || "").length).toBeLessThanOrEqual(64);
  expect(frontmatter?.description).toBeTruthy();
  expect((frontmatter?.description || "").length).toBeLessThanOrEqual(1024);

  if (frontmatter?.type) {
    expect(["prompt", "inline", "flow"]).toContain(frontmatter.type);
  }
};

describe("shipped skills", () => {
  it.each(installedSkills)(
    "$skillId has valid Kimi/Kiro frontmatter under $sourceDirectory",
    ({ skillId, sourceDirectory }) => {
      expectValidSkillFrontmatter(path.join(skillRoot, sourceDirectory, "SKILL.md"), skillId);
    },
  );
});

// Skills with side effects the user starts by name; the model never runs them on its own.
const manualOnlySkillIds = [
  "benchmark-agents",
  "clean-repo-by-feature",
  "clone-all-repos",
  "finish-old-sessions",
  "install-skills",
  "make-promo-video",
  "ship-missing-tests",
  "simplify-repo-with-tests",
  "write-blog-post",
];

describe("manual-only skills", () => {
  it.each(installedSkills)(
    "$skillId is hidden from the model in Claude Code and Codex only when it is manual-only",
    ({ skillId, sourceDirectory, shippedPaths }) => {
      const { frontmatter } = parseFrontmatter(path.join(skillRoot, sourceDirectory, "SKILL.md"));
      const codexPolicy = path.join(skillRoot, sourceDirectory, "agents", "openai.yaml");
      const codexPolicyText = existsSync(codexPolicy) ? readFileSync(codexPolicy, "utf8") : "";
      const codexPolicyDocument = parse(codexPolicyText);
      const isManualOnly = manualOnlySkillIds.includes(skillId);

      expect(frontmatter?.["disable-model-invocation"] === true).toBe(isManualOnly);
      expect(codexPolicyDocument?.policy?.allow_implicit_invocation === false).toBe(isManualOnly);
      expect(shippedPaths.includes("agents")).toBe(existsSync(codexPolicy));
    },
  );
});

const shippedSkillFiles = readdirSync(skillRoot, { recursive: true, encoding: "utf8" })
  .filter((relativePath) => !relativePath.includes("node_modules"))
  .filter((relativePath) => /\.(md|mjs|js|ts|py|sh|json|txt)$/.test(relativePath))
  .sort();

describe("run report folders", () => {
  const sharedGuidePath = path.join(skillRoot, "_shared", "agent-artifacts.md");

  it("keeps each run in the user state directory with one report.md", () => {
    const text = readFileSync(sharedGuidePath, "utf8");
    expect(text).toMatch(/XDG_STATE_HOME:-\$HOME\/\.local\/state/);
    expect(text).toMatch(/agent-setup\/runs\/\$REPO\/\$SKILL/);
    expect(text).toMatch(/date \+%Y-%m-%d-%H%M/);
    expect(text).toMatch(/report\.md/);
  });

  it.each([
    "run-tasks-in-parallel",
    "find-missing-tests",
    "ship-missing-tests",
    "simplify-repo-with-tests",
    "restructure-repo",
    "clean-repo-by-feature",
    "improve-ux",
    "benchmark-agents",
  ])("%s starts its run folder with its own SKILL id", (sourceDirectory) => {
    const skillMd = path.join(skillRoot, sourceDirectory, "SKILL.md");
    const text = readFileSync(skillMd, "utf8");
    expect(text).toContain(`SKILL="${sourceDirectory}"`);
    expect(text).toMatch(/RUN_DIR/);
  });

  it.each(shippedSkillFiles)("%s never writes into a repository docs/ folder", (relativePath) => {
    const text = readFileSync(path.join(skillRoot, relativePath), "utf8");
    // e.g. "`docs/agent/improve-ux/`" or "./docs/adr" match; "https://example.com/docs/agent-setup" does not
    expect(text).not.toMatch(/(?<![\w-]\/)docs\/(agent|agents|adr|learning)\b/);
    expect(text).not.toMatch(/TEACH\.md/);
  });
});

describe("local skill sources", () => {
  it.each(sourceSkillDirectories)("%s is kebab-case and has valid skill frontmatter", (sourceDirectory) => {
    // e.g. "image-to-code" — not "imageToCode"
    expect(sourceDirectory).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

    const feature = featureCatalog.find((candidate) => candidate.sourceDirectory === sourceDirectory);
    // The installed skill id, or the directory name when the catalog has no installed skill id.
    const expectedName = feature?.installedSkill._tag === "skill" ? feature.installedSkill.id : sourceDirectory;

    expectValidSkillFrontmatter(path.join(skillRoot, sourceDirectory, "SKILL.md"), expectedName);
  });
});

describe("repeated workflow skills", () => {
  it.each(flowSkills)("$skillId declares searchable triggers and operational gates", ({ skillId, sourceDirectory }) => {
    const skillMd = path.join(skillRoot, sourceDirectory, "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);

    const { frontmatter, body: skillInstructions } = parseFrontmatter(skillMd);
    expect(frontmatter?.name).toBe(skillId);
    expect(frontmatter?.description).toMatch(/^Use (only )?when /);
    expect(skillInstructions).toContain("## Safety");
    expect(skillInstructions).toContain("## Workflow");
    expect(skillInstructions).toContain("## Verification");
    expect(skillInstructions.split("\n").length).toBeLessThanOrEqual(500);
  });
});
