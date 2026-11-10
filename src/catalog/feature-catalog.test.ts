import { describe, expect, it } from "vitest";

import {
  addDependencies,
  defaultFeatureIds,
  featureCatalog,
  featureCatalogSchema,
  featureIdSchema,
  findFeature,
  listSkillsForFeatures,
} from "./feature-catalog.js";

const expectedFeatureIds = [
  "active-run-reminder",
  "scratch-folder-guard",
  "process-kill-guard",
  "git-hook-guard",
  "session-rehome",
  "disk-cleanup",
  "leftover-process-cleanup",
  "image-to-code",
  "github-repo-about",
  "write-blog-post",
  "write-readme",
  "update-agent-docs",
  "make-code-readable",
  "simplify-code",
  "question-my-plan",
  "ask-before-build",
  "code-style",
  "code-style-teach-me",
  "code-style-review",
  "explain-my-stack",
  "plan-page",
  "website-speed-ci",
  "chrome-store-seo",
  "make-promo-video",
  "check-website-quality",
  "organize-commits",
  "finish-and-push",
  "run-local-and-check",
  "run-ci-locally",
  "reuse-before-build",
  "find-repeated-prompts",
  "install-skills",
  "fix-env-config",
  "add-mcp-server",
  "check-rtl-ui",
  "deploy-and-check",
  "fix-bug",
  "run-tasks-in-parallel",
  "ship-one-feature",
  "find-missing-tests",
  "ship-missing-tests",
  "simplify-repo-with-tests",
  "restructure-repo",
  "improve-ux",
  "design-app-mockup",
  "free-ports",
  "clone-all-repos",
  "manage-cloudflare",
  "clean-repo-by-feature",
  "add-skill",
  "improve-skill",
  "which-skill",
  "benchmark-agents",
  "release-mobile-app",
  "save-as-skill",
  "finish-old-sessions",
];

const expectedOriginDirectories = [
  "active-run-reminder",
  "scratch-folder-guard",
  "process-kill-guard",
  "git-hook-guard",
  "session-rehome",
  "disk-cleanup",
  "leftover-process-cleanup",
  "image-to-code",
  "github-repo-about",
  "write-blog-post",
  "write-readme",
  "update-agent-docs",
  "make-code-readable",
  "simplify-code",
  "question-my-plan",
  "ask-before-build",
  "code-style",
  "code-style-teach-me",
  "code-style-review",
  "explain-my-stack",
  "plan-page",
  "website-speed-ci",
  "chrome-store-seo",
  "make-promo-video",
  "check-website-quality",
  "organize-commits",
  "finish-and-push",
  "run-local-and-check",
  "run-ci-locally",
  "reuse-before-build",
  "find-repeated-prompts",
  "install-skills",
  "fix-env-config",
  "add-mcp-server",
  "check-rtl-ui",
  "deploy-and-check",
  "fix-bug",
  "run-tasks-in-parallel",
  "ship-one-feature",
  "find-missing-tests",
  "ship-missing-tests",
  "simplify-repo-with-tests",
  "restructure-repo",
  "improve-ux",
  "design-app-mockup",
  "free-ports",
  "clone-all-repos",
  "manage-cloudflare",
  "clean-repo-by-feature",
  "add-skill",
  "improve-skill",
  "which-skill",
  "benchmark-agents",
  "release-mobile-app",
  "save-as-skill",
  "finish-old-sessions",
];

const validFixture = [
  {
    id: "alpha",
    sourceDirectory: "alpha",
    installedSkill: {
      _tag: "skill",
      id: "alpha",
      shippedPaths: ["SKILL.md"],
    },
    title: "Alpha",
    summary: "Alpha feature.",
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: { _tag: "none" },
  },
  {
    id: "beta",
    sourceDirectory: "beta",
    installedSkill: {
      _tag: "skill",
      id: "beta",
      shippedPaths: ["SKILL.md", "reference"],
    },
    title: "Beta",
    summary: "Beta feature.",
    selectedByDefault: false,
    dependencies: ["alpha"],
    platform: "macos",
    runtime: {
      _tag: "hook",
      sourceEntrypoint: "hooks/beta.ts",
      registrations: [
        {
          event: "Stop",
          matcher: { _tag: "none" },
          entrypoint: { _tag: "featureDefault" },
          readsAgentId: false,
        },
      ],
    },
  },
];

const decodeFixture = (uncheckedCatalog: unknown) => featureCatalogSchema.safeParse(uncheckedCatalog);

describe("featureCatalog", () => {
  it("decodes all approved features in display order", () => {
    expect(featureCatalog.map((feature) => feature.id)).toEqual(expectedFeatureIds);
  });

  it("keeps public IDs, authored directories, and installed IDs distinct", () => {
    expect(featureCatalog.map((feature) => feature.sourceDirectory)).toEqual(expectedOriginDirectories);
  });

  it("derives defaults, installed skills, and exact shipped allowlists", () => {
    expect(defaultFeatureIds).toEqual(["scratch-folder-guard", "process-kill-guard", "git-hook-guard"]);
    const scratchFolderGuardId = featureIdSchema.parse("scratch-folder-guard");
    const gitHookGuardId = featureIdSchema.parse("git-hook-guard");

    expect(listSkillsForFeatures([scratchFolderGuardId, gitHookGuardId])).toEqual([]);
    expect(
      listSkillsForFeatures(featureCatalog.map((feature) => feature.id)).map((skill) => [skill.id, skill.shippedPaths]),
    ).toEqual([
      [
        "image-to-code",
        [
          "SKILL.md",
          "README.md",
          "CONTEXT.md",
          "TECH-GLOSSARY.md",
          "reference",
          "scripts/package.json",
          "scripts/svgo.config.mjs",
          "scripts/tsconfig.json",
          "scripts/src",
        ],
      ],
      ["github-repo-about", ["SKILL.md"]],
      ["write-blog-post", ["SKILL.md", "agents"]],
      ["write-readme", ["SKILL.md", "references"]],
      ["update-agent-docs", ["SKILL.md", "sources.json", "scripts"]],
      ["make-code-readable", ["SKILL.md", "references"]],
      ["simplify-code", ["SKILL.md", "references"]],
      ["question-my-plan", ["SKILL.md"]],
      ["ask-before-build", ["SKILL.md"]],
      ["code-style", ["SKILL.md", "ADOPT.md", "NEW-PROJECT.md", "_shared"]],
      ["code-style-teach-me", ["SKILL.md"]],
      ["code-style-review", ["SKILL.md"]],
      ["explain-my-stack", ["SKILL.md", "TEACH-FORMAT.md"]],
      ["plan-page", ["SKILL.md", "COMPONENTS.md"]],
      [
        "website-speed-ci",
        ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "scripts", "templates"],
      ],
      ["chrome-store-seo", ["SKILL.md", "REFERENCE.md", "scripts", "templates"]],
      ["make-promo-video", ["SKILL.md", "reference", "scripts", "agents"]],
      ["check-website-quality", ["SKILL.md", "reference", "scripts", "templates"]],
      ["organize-commits", ["SKILL.md", "REFERENCE.md"]],
      ["finish-and-push", ["SKILL.md"]],
      ["run-local-and-check", ["SKILL.md"]],
      ["run-ci-locally", ["SKILL.md", "scripts"]],
      ["reuse-before-build", ["SKILL.md"]],
      ["find-repeated-prompts", ["SKILL.md", "scripts"]],
      ["install-skills", ["SKILL.md", "agents"]],
      ["fix-env-config", ["SKILL.md"]],
      ["add-mcp-server", ["SKILL.md"]],
      ["check-rtl-ui", ["SKILL.md"]],
      ["deploy-and-check", ["SKILL.md"]],
      ["fix-bug", ["SKILL.md"]],
      ["run-tasks-in-parallel", ["SKILL.md", "REFERENCE.md"]],
      ["ship-one-feature", ["SKILL.md", "REFERENCE.md"]],
      ["find-missing-tests", ["SKILL.md", "REFERENCE.md", "references"]],
      ["ship-missing-tests", ["SKILL.md", "REFERENCE.md", "references", "agents"]],
      ["simplify-repo-with-tests", ["SKILL.md", "REFERENCE.md", "references", "agents"]],
      ["restructure-repo", ["SKILL.md", "REFERENCE.md", "EXAMPLES.md"]],
      ["improve-ux", ["SKILL.md", "REFERENCE.md"]],
      ["design-app-mockup", ["SKILL.md", "REFERENCE.md", "scripts"]],
      ["free-ports", ["SKILL.md"]],
      ["clone-all-repos", ["SKILL.md", "agents"]],
      ["manage-cloudflare", ["SKILL.md"]],
      ["clean-repo-by-feature", ["SKILL.md", "agents"]],
      ["add-skill", ["SKILL.md", "REFERENCE.md"]],
      ["improve-skill", ["SKILL.md"]],
      ["which-skill", ["SKILL.md", "REFERENCE.md"]],
      ["benchmark-agents", ["SKILL.md", "REFERENCE.md", "agents", "scripts"]],
      ["release-mobile-app", ["SKILL.md"]],
      ["save-as-skill", ["SKILL.md"]],
      ["finish-old-sessions", ["SKILL.md", "agents"]],
    ]);
  });

  it("stores authored TypeScript hook entrypoints and no generated JavaScript paths", () => {
    const runtimeFeatures = featureCatalog.flatMap((feature) => {
      const runtime = feature.runtime;
      const isNotHookRuntime = runtime._tag !== "hook";

      if (isNotHookRuntime) return [];

      return [
        {
          id: feature.id,
          platform: feature.platform,
          sourceEntrypoint: runtime.sourceEntrypoint,
          registrations: runtime.registrations,
        },
      ];
    });

    expect(runtimeFeatures).toEqual([
      {
        id: "active-run-reminder",
        platform: "any",
        sourceEntrypoint: "hooks/active-run-reminder.ts",
        registrations: [
          {
            event: "SessionStart",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
          {
            event: "SubagentStart",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
        ],
      },
      {
        id: "scratch-folder-guard",
        platform: "any",
        sourceEntrypoint: "hooks/scratch-folder-guard.ts",
        registrations: [
          {
            event: "PreToolUse",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
          {
            event: "Stop",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/ask-scratch-cleanup.ts" },
            readsAgentId: true,
          },
          {
            event: "SessionEnd",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/clear-session-scratch.ts" },
            readsAgentId: false,
          },
        ],
      },
      {
        id: "process-kill-guard",
        platform: "any",
        sourceEntrypoint: "hooks/process-kill-guard.ts",
        registrations: [
          {
            event: "PreToolUse",
            matcher: { _tag: "pattern", value: "Bash" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
        ],
      },
      {
        id: "git-hook-guard",
        platform: "any",
        sourceEntrypoint: "hooks/git-hook-guard.ts",
        registrations: [
          {
            event: "PreToolUse",
            matcher: { _tag: "pattern", value: "Bash" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
        ],
      },
      {
        id: "session-rehome",
        platform: "any",
        sourceEntrypoint: "hooks/rehome-ended-session.ts",
        registrations: [
          {
            event: "SessionEnd",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: true,
          },
          {
            event: "SessionStart",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/announce-moved-session.ts" },
            readsAgentId: true,
          },
        ],
      },
      {
        id: "disk-cleanup",
        platform: "any",
        sourceEntrypoint: "hooks/clean-up-ended-session.ts",
        registrations: [
          {
            event: "SessionEnd",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
        ],
      },
      {
        id: "leftover-process-cleanup",
        platform: "any",
        sourceEntrypoint: "hooks/stop-leftover-processes.ts",
        registrations: [
          {
            event: "Stop",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
            runsInBackground: true,
          },
          {
            event: "SubagentStop",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
            runsInBackground: true,
          },
        ],
      },
    ]);
    expect(
      featureCatalog.filter((feature) => feature.platform !== "any").map((feature) => [feature.id, feature.platform]),
    ).toEqual([["make-promo-video", "macos"]]);
  });

  it("finds features and represents absence with null", () => {
    expect(findFeature("plan-page")?.title).toBe("Plan page");
    expect(findFeature("missing-feature")).toBeNull();
  });

  it("expands dependencies once and returns stable catalog order", () => {
    expect(
      featureCatalog
        .filter((feature) => feature.dependencies.length > 0)
        .map((feature) => [feature.id, feature.dependencies]),
    ).toEqual([
      ["question-my-plan", ["code-style"]],
      ["make-promo-video", ["plan-page"]],
      ["finish-and-push", ["organize-commits"]],
      ["run-tasks-in-parallel", ["organize-commits", "finish-and-push", "run-local-and-check", "active-run-reminder"]],
      ["ship-one-feature", ["run-tasks-in-parallel", "finish-and-push", "organize-commits"]],
      ["find-missing-tests", ["run-tasks-in-parallel", "organize-commits", "finish-and-push"]],
      [
        "ship-missing-tests",
        [
          "find-missing-tests",
          "clean-repo-by-feature",
          "run-tasks-in-parallel",
          "organize-commits",
          "finish-and-push",
          "ship-one-feature",
        ],
      ],
      [
        "simplify-repo-with-tests",
        ["simplify-code", "run-tasks-in-parallel", "organize-commits", "finish-and-push", "find-missing-tests"],
      ],
      ["restructure-repo", ["make-code-readable", "simplify-code"]],
      [
        "improve-ux",
        ["plan-page", "run-tasks-in-parallel", "finish-and-push", "organize-commits", "run-local-and-check"],
      ],
      ["clean-repo-by-feature", ["run-tasks-in-parallel", "finish-and-push", "organize-commits"]],
      ["finish-old-sessions", ["finish-and-push", "find-repeated-prompts"]],
    ]);
    expect(addDependencies(["make-promo-video"])).toEqual({
      status: "ready",
      featureIds: ["plan-page", "make-promo-video"],
    });
  });

  it("returns an unknown-feature status with the unknown ID", () => {
    const dependencyReply = addDependencies(["not-installed"]);

    expect(dependencyReply).toEqual({ status: "unknown", featureId: "not-installed" });
  });
});

describe("featureCatalogSchema", () => {
  it("accepts a complete valid unknown fixture", () => {
    expect(decodeFixture(validFixture).success).toBe(true);
  });

  it.each([
    {
      name: "duplicate feature IDs",
      input: [validFixture[0], { ...validFixture[1], id: "alpha" }],
      message: "Feature IDs must be unique",
    },
    {
      name: "duplicate source directories",
      input: [validFixture[0], { ...validFixture[1], sourceDirectory: "alpha" }],
      message: "Source directories must be unique",
    },
    {
      name: "duplicate installed skill IDs",
      input: [
        validFixture[0],
        { ...validFixture[1], installedSkill: { _tag: "skill", id: "alpha", shippedPaths: [] } },
      ],
      message: "Installed skill IDs must be unique",
    },
    {
      name: "missing dependencies",
      input: [validFixture[0], { ...validFixture[1], dependencies: ["missing"] }],
      message: "Dependencies must reference catalog features",
    },
    {
      name: "dependency cycles",
      input: [{ ...validFixture[0], dependencies: ["beta"] }, validFixture[1]],
      message: "Feature dependencies must be acyclic",
    },
    {
      name: "excess properties",
      input: [{ ...validFixture[0], unexpected: true }, validFixture[1]],
      message: "Unrecognized key",
    },
    {
      name: "generated runtime entrypoints",
      input: [
        validFixture[0],
        {
          ...validFixture[1],
          runtime: {
            _tag: "hook",
            sourceEntrypoint: "hooks/beta.js",
            registrations: [],
          },
        },
      ],
      message: "must end in .ts",
    },
  ])("rejects $name", ({ input: invalidCatalog, message }) => {
    const featureCatalogCheck = decodeFixture(invalidCatalog);

    expect(featureCatalogCheck.success).toBe(false);
    expect(String(featureCatalogCheck.error)).toContain(message);
  });
});
