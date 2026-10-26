import { Either, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  addDependencies,
  defaultFeatureIds,
  featureCatalog,
  featureCatalogSchema,
  findFeature,
  skillsForFeatures,
  UnknownFeatureError,
} from "./featureCatalog.js";

const expectedFeatureIds = [
  "context-guard",
  "autorun",
  "duplicate-code-guard",
  "scratch-folder-guard",
  "process-kill-guard",
  "git-hook-guard",
  "session-rehome",
  "disk-cleanup",
  "image-to-code",
  "github-repo-about",
  "write-blog-post",
  "write-readme",
  "update-agent-docs",
  "make-code-readable",
  "simplify-code",
  "question-my-plan",
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

const expectedSourceDirectories = [
  "contextGuard",
  "autorun",
  "duplicateCodeGuard",
  "scratchFolderGuard",
  "processKillGuard",
  "gitHookGuard",
  "sessionRehome",
  "diskCleanup",
  "imageToCode",
  "githubRepoAbout",
  "writeBlogPost",
  "writeReadme",
  "updateAgentDocs",
  "makeCodeReadable",
  "simplifyCode",
  "questionMyPlan",
  "codeStyle",
  "codeStyleTeachMe",
  "codeStyleReview",
  "explainMyStack",
  "planPage",
  "websiteSpeedCi",
  "chromeStoreSeo",
  "makePromoVideo",
  "checkWebsiteQuality",
  "organizeCommits",
  "finishAndPush",
  "runLocalAndCheck",
  "runCiLocally",
  "reuseBeforeBuild",
  "findRepeatedPrompts",
  "installSkills",
  "fixEnvConfig",
  "addMcpServer",
  "checkRtlUi",
  "deployAndCheck",
  "fixBug",
  "runTasksInParallel",
  "shipOneFeature",
  "findMissingTests",
  "shipMissingTests",
  "simplifyRepoWithTests",
  "restructureRepo",
  "improveUx",
  "designAppMockup",
  "freePorts",
  "cloneAllRepos",
  "manageCloudflare",
  "cleanRepoByFeature",
  "addSkill",
  "improveSkill",
  "whichSkill",
  "benchmarkAgents",
  "releaseMobileApp",
  "saveAsSkill",
  "finishOldSessions",
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

const decodeFixture = Schema.decodeUnknownEither(featureCatalogSchema, { onExcessProperty: "error" });

describe("featureCatalog", () => {
  it("decodes all approved features in display order", () => {
    expect(featureCatalog.map((feature) => feature.id)).toEqual(expectedFeatureIds);
  });

  it("keeps public IDs, authored directories, and installed IDs distinct", () => {
    expect(featureCatalog.map((feature) => feature.sourceDirectory)).toEqual(expectedSourceDirectories);
    expect(featureCatalog.find((feature) => feature.id === "autorun")).toMatchObject({
      sourceDirectory: "autorun",
      installedSkill: { _tag: "skill", id: "autorun" },
    });
  });

  it("derives defaults, installed skills, and exact shipped allowlists", () => {
    expect(defaultFeatureIds).toEqual(["scratch-folder-guard", "process-kill-guard", "git-hook-guard"]);
    expect(skillsForFeatures(["context-guard", "duplicate-code-guard"])).toEqual([]);
    expect(
      skillsForFeatures(featureCatalog.map((feature) => feature.id)).map((skill) => [skill.id, skill.shippedPaths]),
    ).toEqual([
      ["autorun", ["SKILL.md", "agents"]],
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
      [
        "code-style",
        ["SKILL.md", "NEW-PROJECT.md", "EXISTING-PROJECT.md", "SCAN.md", "_shared", "references", "scripts"],
      ],
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
    const runtimeFeatures = featureCatalog.flatMap((feature) =>
      feature.runtime._tag === "hook"
        ? [
            {
              id: feature.id,
              platform: feature.platform,
              sourceEntrypoint: feature.runtime.sourceEntrypoint,
              registrations: feature.runtime.registrations,
            },
          ]
        : [],
    );

    expect(runtimeFeatures).toEqual([
      {
        id: "context-guard",
        platform: "any",
        sourceEntrypoint: "hooks/contextGuard.ts",
        registrations: [
          {
            event: "PreToolUse",
            matcher: { _tag: "pattern", value: "Write|Edit|MultiEdit|NotebookEdit" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
          {
            event: "PostToolUse",
            matcher: { _tag: "pattern", value: "Write|Edit|MultiEdit|NotebookEdit" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
          {
            event: "UserPromptSubmit",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
          {
            event: "SessionStart",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/startAutorunWatcher.ts" },
            readsAgentId: false,
          },
          {
            event: "SessionStart",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/recordIdleCompactEvent.ts" },
            readsAgentId: true,
          },
          {
            event: "UserPromptSubmit",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/recordIdleCompactEvent.ts" },
            readsAgentId: true,
          },
          {
            event: "Stop",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/recordIdleCompactEvent.ts" },
            readsAgentId: true,
          },
          {
            event: "PreCompact",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/recordIdleCompactEvent.ts" },
            readsAgentId: true,
          },
          {
            event: "PostCompact",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/recordIdleCompactEvent.ts" },
            readsAgentId: true,
          },
          {
            event: "SessionEnd",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/recordIdleCompactEvent.ts" },
            readsAgentId: true,
          },
        ],
      },
      {
        id: "duplicate-code-guard",
        platform: "any",
        sourceEntrypoint: "hooks/duplicateCodeGuard.ts",
        registrations: [
          {
            event: "PreToolUse",
            matcher: { _tag: "pattern", value: "Write|Edit|MultiEdit" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
        ],
      },
      {
        id: "scratch-folder-guard",
        platform: "any",
        sourceEntrypoint: "hooks/scratchFolderGuard.ts",
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
            entrypoint: { _tag: "path", value: "hooks/askScratchCleanup.ts" },
            readsAgentId: true,
          },
          {
            event: "SessionEnd",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "path", value: "hooks/clearSessionScratch.ts" },
            readsAgentId: false,
          },
        ],
      },
      {
        id: "process-kill-guard",
        platform: "any",
        sourceEntrypoint: "hooks/processKillGuard.ts",
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
        sourceEntrypoint: "hooks/gitHookGuard.ts",
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
        sourceEntrypoint: "hooks/rehomeEndedSession.ts",
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
            entrypoint: { _tag: "path", value: "hooks/announceMovedSession.ts" },
            readsAgentId: true,
          },
        ],
      },
      {
        id: "disk-cleanup",
        platform: "any",
        sourceEntrypoint: "hooks/cleanUpEndedSession.ts",
        registrations: [
          {
            event: "SessionEnd",
            matcher: { _tag: "none" },
            entrypoint: { _tag: "featureDefault" },
            readsAgentId: false,
          },
        ],
      },
    ]);
    expect(
      featureCatalog.filter((feature) => feature.platform !== "any").map((feature) => [feature.id, feature.platform]),
    ).toEqual([
      ["autorun", "macos+ghostty"],
      ["make-promo-video", "macos"],
    ]);
  });

  it("finds features with Option", () => {
    expect(Option.map(findFeature("plan-page"), (feature) => feature.title)).toEqual(Option.some("Plan page"));
    expect(findFeature("missing-feature")).toEqual(Option.none());
  });

  it("expands dependencies once and returns stable catalog order", () => {
    expect(
      featureCatalog
        .filter((feature) => feature.dependencies.length > 0)
        .map((feature) => [feature.id, feature.dependencies]),
    ).toEqual([
      ["autorun", ["context-guard"]],
      ["question-my-plan", ["code-style"]],
      ["make-promo-video", ["plan-page"]],
      ["finish-and-push", ["organize-commits"]],
      ["run-tasks-in-parallel", ["organize-commits", "finish-and-push", "run-local-and-check"]],
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
    expect(Either.getOrThrowWith(addDependencies(["make-promo-video", "autorun", "context-guard"]), String)).toEqual([
      "context-guard",
      "autorun",
      "plan-page",
      "make-promo-video",
    ]);
  });

  it("returns a tagged unknown-feature error", () => {
    const featureCatalogCheck = addDependencies(["not-installed"]);

    expect(Either.isLeft(featureCatalogCheck)).toBe(true);
    expect(Option.getOrThrow(Either.getLeft(featureCatalogCheck))).toBeInstanceOf(UnknownFeatureError);
    expect(Option.getOrThrow(Either.getLeft(featureCatalogCheck)).featureId).toBe("not-installed");
  });
});

describe("featureCatalogSchema", () => {
  it("accepts a complete valid unknown fixture", () => {
    expect(Either.isRight(decodeFixture(validFixture))).toBe(true);
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
      message: "is unexpected",
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
  ])("rejects $name", ({ input, message }) => {
    const featureCatalogCheck = decodeFixture(input);

    expect(Either.isLeft(featureCatalogCheck)).toBe(true);
    expect(String(Option.getOrThrow(Either.getLeft(featureCatalogCheck)))).toContain(message);
  });
});
