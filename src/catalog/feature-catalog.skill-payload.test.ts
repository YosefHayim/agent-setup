import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { featureCatalog, listSkillsForFeatures } from "./feature-catalog.js";

type Frontmatter = {
  name?: string;
  description?: string;
  type?: string;
  "disable-model-invocation"?: boolean;
  effort?: string;
};

const parseFrontmatter = (file: string): { frontmatter: Frontmatter | null; body: string } => {
  const skillMarkdown = readFileSync(file, "utf8");

  // e.g. "---\nname: foo\n---\n# body" → groups: frontmatter block, body
  const frontmatterParts = skillMarkdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  const isThereNoFrontmatter = frontmatterParts == null;
  if (isThereNoFrontmatter) return { frontmatter: null, body: skillMarkdown };

  const frontmatter: Frontmatter = parse(frontmatterParts[1]);
  return { frontmatter, body: frontmatterParts[2] };
};

const skillRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

const installedSkills = listSkillsForFeatures(featureCatalog.map((feature) => feature.id)).map((skill) => {
  const feature = featureCatalog.find(
    (candidate) => candidate.installedSkill._tag === "skill" && candidate.installedSkill.id === skill.id,
  );

  const isFeatureMissing = feature == null;
  if (isFeatureMissing) {
    throw new Error(`Installed skill ${skill.id} is missing a catalog feature.`);
  }

  return {
    skillId: skill.id,
    sourceDirectory: feature.sourceDirectory,
    shippedPaths: skill.shippedPaths,
  };
});

const originSkillDirectories = readdirSync(skillRoot, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .filter((dirent) => existsSync(path.join(skillRoot, dirent.name, "SKILL.md")))
  .map((dirent) => dirent.name)
  .sort();

const flowSkills = originSkillDirectories.flatMap((originDirectory) => {
  const skillMd = path.join(skillRoot, originDirectory, "SKILL.md");

  const { frontmatter } = parseFrontmatter(skillMd);
  const isNotNamedFlowSkill = frontmatter?.type !== "flow" || frontmatter.name == null;

  if (isNotNamedFlowSkill) return [];

  return [{ skillId: frontmatter.name, sourceDirectory: originDirectory }];
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

  const isSkillTypeSet = frontmatter?.type != null;

  if (isSkillTypeSet) {
    expect(["prompt", "inline", "flow"]).toContain(frontmatter.type);
  }

  const isEffortSet = frontmatter?.effort != null;

  if (isEffortSet) {
    expect(["low", "medium", "high", "xhigh", "max"]).toContain(frontmatter.effort);
  }
};

describe("shipped skills", () => {
  it.each(installedSkills)(
    "$skillId has valid Kimi/Kiro frontmatter under $sourceDirectory",
    ({ skillId, sourceDirectory: originDirectory }) => {
      expectValidSkillFrontmatter(path.join(skillRoot, originDirectory, "SKILL.md"), skillId);
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
    ({ skillId, sourceDirectory: originDirectory, shippedPaths }) => {
      const { frontmatter } = parseFrontmatter(path.join(skillRoot, originDirectory, "SKILL.md"));
      const codexPolicy = path.join(skillRoot, originDirectory, "agents", "openai.yaml");
      const isCodexPolicyPresent = existsSync(codexPolicy);
      const codexPolicyString = isCodexPolicyPresent ? readFileSync(codexPolicy, "utf8") : "";
      const codexPolicyDocument = parse(codexPolicyString);
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
    const sharedGuideMarkdown = readFileSync(sharedGuidePath, "utf8");
    expect(sharedGuideMarkdown).toMatch(/XDG_STATE_HOME:-\$HOME\/\.local\/state/);
    expect(sharedGuideMarkdown).toMatch(/agent-setup\/runs\/\$REPO\/\$SKILL/);
    expect(sharedGuideMarkdown).toMatch(/date \+%Y-%m-%d-%H%M/);
    expect(sharedGuideMarkdown).toMatch(/report\.md/);
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
  ])("%s starts its run folder with its own SKILL id", (originDirectory) => {
    const skillMd = path.join(skillRoot, originDirectory, "SKILL.md");
    const skillMarkdown = readFileSync(skillMd, "utf8");
    expect(skillMarkdown).toContain(`SKILL="${originDirectory}"`);
    expect(skillMarkdown).toMatch(/RUN_DIR/);
  });

  it.each(shippedSkillFiles)("%s never writes into a repository docs/ folder", (relativePath) => {
    const skillMarkdown = readFileSync(path.join(skillRoot, relativePath), "utf8");
    // e.g. "`docs/agent/improve-ux/`" or "./docs/adr" match; "https://example.com/docs/agent-setup" does not
    expect(skillMarkdown).not.toMatch(/(?<![\w-]\/)docs\/(agent|agents|adr|learning)\b/);
    expect(skillMarkdown).not.toMatch(/TEACH\.md/);
  });
});

describe("local skill sources", () => {
  it.each(originSkillDirectories)("%s is kebab-case and has valid skill frontmatter", (originDirectory) => {
    // e.g. "image-to-code" — not "imageToCode"
    expect(originDirectory).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

    const feature = featureCatalog.find((candidate) => candidate.sourceDirectory === originDirectory);
    // The installed skill id, or the directory name when the catalog has no installed skill id.
    const installedSkill = feature?.installedSkill;
    const isSkillInstalled = installedSkill?._tag === "skill";
    const expectedName = isSkillInstalled ? installedSkill.id : originDirectory;

    expectValidSkillFrontmatter(path.join(skillRoot, originDirectory, "SKILL.md"), expectedName);
  });
});

describe("repeated workflow skills", () => {
  it.each(flowSkills)(
    "$skillId declares searchable triggers and operational gates",
    ({ skillId, sourceDirectory: originDirectory }) => {
      const skillMd = path.join(skillRoot, originDirectory, "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);

      const { frontmatter, body: skillInstructions } = parseFrontmatter(skillMd);
      expect(frontmatter?.name).toBe(skillId);
      expect(frontmatter?.description).toMatch(/^Use (only )?when /);
      expect(skillInstructions).toContain("## Safety");
      expect(skillInstructions).toContain("## Workflow");
      expect(skillInstructions).toContain("## Verification");
      expect(skillInstructions.split("\n").length).toBeLessThanOrEqual(500);
    },
  );
});
