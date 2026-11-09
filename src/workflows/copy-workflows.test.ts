import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { copyWorkflows, fillPublishTemplate, planWorkflowFiles } from "./copy-workflows.js";

const templateDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates/workflows");

const inputs = { owner: "Acme", repo: "widget", packageName: "widget-cli" };

const temporaryRoots: Array<string> = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// A temporary repository whose package.json names "test-pkg".
const makeRepository = (): string => {
  const targetRoot = mkdtempSync(path.join(tmpdir(), "agent-setup-workflows-"));
  temporaryRoots.push(targetRoot);
  writeFileSync(path.join(targetRoot, "package.json"), JSON.stringify({ name: "test-pkg" }));
  return targetRoot;
};

describe("fillPublishTemplate", () => {
  it("substitutes every OWNER, REPO and PACKAGE placeholder", () => {
    const filled = fillPublishTemplate({ template: "{{OWNER}}/{{REPO}} ships {{PACKAGE}} — {{OWNER}} again", inputs });

    expect(filled).toBe("Acme/widget ships widget-cli — Acme again");
  });
});

describe("planWorkflowFiles", () => {
  it("fills publish.yml, passes other workflows through verbatim, and drops non-yml", () => {
    const planned = planWorkflowFiles({
      files: [
        { name: "ci.yml", text: "name: CI\nrun: pnpm check\n" },
        { name: "publish.yml", text: "{{OWNER}}/{{REPO}} ships {{PACKAGE}}" },
        { name: "README.md", text: "ignore me" },
      ],
      inputs,
    });

    expect(planned).toEqual([
      { name: "ci.yml", content: "name: CI\nrun: pnpm check\n" },
      { name: "publish.yml", content: "Acme/widget ships widget-cli" },
    ]);
  });
});

describe("copyWorkflows", () => {
  it("copies the lean workflow set, templating only publish.yml", async () => {
    const targetRoot = makeRepository();
    const workflows = path.join(targetRoot, ".github", "workflows");

    const copied = await copyWorkflows({ targetRoot, templateDirectory, force: false });
    const ciYml = readFileSync(path.join(workflows, "ci.yml"), "utf8");
    const publishYml = readFileSync(path.join(workflows, "publish.yml"), "utf8");

    expect(copied.written).toEqual(["ci.yml", "publish.yml", "report-failure.yml"]);
    expect(readdirSync(workflows).sort()).toEqual(copied.written);
    expect(ciYml).toContain("run: pnpm check");
    expect(ciYml).not.toContain("YosefHayim/agent-setup");
    expect(ciYml).not.toContain("setup-uv");
    expect(publishYml).toContain("test-pkg");
    expect(publishYml).not.toMatch(/\{\{\s*(OWNER|REPO|PACKAGE)\s*\}\}/);
    expect(publishYml).not.toContain("setup-uv");
  });

  it("keeps existing workflow files unless force is true", async () => {
    const targetRoot = makeRepository();
    const ciPath = path.join(targetRoot, ".github", "workflows", "ci.yml");
    await copyWorkflows({ targetRoot, templateDirectory, force: false });
    writeFileSync(ciPath, "name: CUSTOMIZED\n");

    await copyWorkflows({ targetRoot, templateDirectory, force: false });
    expect(readFileSync(ciPath, "utf8")).toBe("name: CUSTOMIZED\n");

    await copyWorkflows({ targetRoot, templateDirectory, force: true });
    expect(readFileSync(ciPath, "utf8")).not.toBe("name: CUSTOMIZED\n");
  });
});
