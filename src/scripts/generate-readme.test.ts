import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configSettings } from "#src/config/config-schema.js";
import { environmentVariables } from "#src/config/environment-variables.js";

const readme = readFileSync(path.resolve("README.md"), "utf8");

const generatedSection = (marker: string): string => {
  const start = `<!-- AUTO:${marker}:START -->`;
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(`<!-- AUTO:${marker}:END -->`);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return readme.slice(startIndex + start.length, endIndex);
};

describe("README generation", () => {
  it("lists agent-setup-owned skills in the catalog, minus community and user-global skills", () => {
    const catalog = generatedSection("FEATURES");

    expect(catalog).toContain("**write-readme**");
    expect(catalog).toContain("**update-agent-docs**");
    expect(catalog).toContain('| **github-repo-about** | Write the GitHub "About" box');
    expect(catalog).toContain("**image-to-code**");

    // Third-party skills are credited in the community table, not the owned catalog.
    expect(catalog).not.toContain("**make-code-readable**");
    expect(catalog).not.toContain("**question-my-plan**");

    expect(catalog).not.toContain("**agents-sdk**");
    expect(catalog).not.toContain("**cloudflare**");
    expect(catalog).not.toContain("**expo-deployment**");
  });

  it("credits third-party skills in a separate community table with upstream links", () => {
    const community = generatedSection("SKILLS");

    expect(community).toContain("**make-code-readable**");
    expect(community).toContain("(upstream: `deslop`)");
    expect(community).toContain("**question-my-plan**");
    expect(community).toContain("(upstream: `grill-me`, `grill-with-docs`)");
    expect(community).toContain("https://github.com/mattpocock/skills");
    expect(community).toContain("https://github.com/mikecann/agent-skills");
    expect(community).not.toContain("**image-to-code**");
    expect(community).not.toContain("**write-readme**");
  });

  it("lists every setting and environment variable under the Settings heading AGENTS.md links to", () => {
    const settings = generatedSection("SETTINGS");

    expect(readme).toContain("\n## Settings\n\n<!-- AUTO:SETTINGS:START -->");
    configSettings.forEach((setting) => {
      expect(settings).toContain(`| \`${setting.name}\` | \`${setting.key}\` |`);
    });
    environmentVariables.forEach((variable) => {
      expect(settings).toContain(`| \`${variable.name}\` |`);
    });
  });

  it("keeps official links for external tools and runtimes and no links into a docs folder", () => {
    expect(readme).toContain("[Claude Code](https://code.claude.com/docs/en/overview)");
    expect(readme).toContain("[Cursor](https://cursor.com/docs)");
    expect(readme).toContain("[TypeScript](https://www.typescriptlang.org/)");
    expect(readme).toContain("[Node.js](https://nodejs.org/en)");
    expect(readme).not.toMatch(/\]\(\.?\/?docs\//u);
  });
});
