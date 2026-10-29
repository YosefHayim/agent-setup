import path from "node:path";
import { fileURLToPath } from "node:url";

import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { Effect } from "effect";

import { copyWorkflows, fillPublishTemplate, planWorkflowFiles } from "./copyWorkflows.js";

const templateDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates/workflows");

const inputs = { owner: "Acme", repo: "widget", packageName: "widget-cli" };

// A temporary repository whose package.json names "test-pkg".
const makeRepository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const targetRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "agent-setup-workflows-" });
  yield* fileSystem.writeFileString(path.join(targetRoot, "package.json"), JSON.stringify({ name: "test-pkg" }));
  return targetRoot;
});

describe("fillPublishTemplate", () => {
  it("substitutes every placeholder", () => {
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

layer(NodeContext.layer)("copyWorkflows", (it) => {
  it.scoped("copies the lean workflow set, templating only publish.yml", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const targetRoot = yield* makeRepository;
      const workflows = path.join(targetRoot, ".github", "workflows");

      const copied = yield* copyWorkflows({ targetRoot, templateDirectory, force: false });
      const ciYml = yield* fileSystem.readFileString(path.join(workflows, "ci.yml"));
      const publishYml = yield* fileSystem.readFileString(path.join(workflows, "publish.yml"));

      expect(copied.written).toEqual(["ci.yml", "publish.yml", "report-failure.yml"]);
      expect((yield* fileSystem.readDirectory(workflows)).sort()).toEqual(copied.written);
      expect(ciYml).toContain("run: pnpm check");
      expect(ciYml).not.toContain("YosefHayim/agent-setup");
      expect(ciYml).not.toContain("setup-uv");
      expect(publishYml).toContain("test-pkg");
      expect(publishYml).not.toMatch(/\{\{\s*(OWNER|REPO|PACKAGE)\s*\}\}/);
      expect(publishYml).not.toContain("setup-uv");
    }),
  );

  it.scoped("keeps existing workflow files unless force is true", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const targetRoot = yield* makeRepository;
      const ciPath = path.join(targetRoot, ".github", "workflows", "ci.yml");
      yield* copyWorkflows({ targetRoot, templateDirectory, force: false });
      yield* fileSystem.writeFileString(ciPath, "name: CUSTOMIZED\n");

      yield* copyWorkflows({ targetRoot, templateDirectory, force: false });
      expect(yield* fileSystem.readFileString(ciPath)).toBe("name: CUSTOMIZED\n");

      yield* copyWorkflows({ targetRoot, templateDirectory, force: true });
      expect(yield* fileSystem.readFileString(ciPath)).not.toBe("name: CUSTOMIZED\n");
    }),
  );
});
