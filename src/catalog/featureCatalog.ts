import { Either, Option, Schema } from "effect";

// e.g. "context-guard", "image-to-code" — not "ContextGuard" or "png_to_code"
const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// e.g. "contextGuard", "imageToCode" — not "context-guard" or "Context_Guard"
const SOURCE_DIRECTORY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
// e.g. "SKILL.md", "watchers/autorunWatcher.ts" — not "/abs/path" or "a/../b"
const FEATURE_RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/;
// e.g. "hooks/duplicateCodeGuard.ts" — feature-relative hook entrypoint only
const HOOK_SOURCE_ENTRYPOINT_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+\.ts$/;

export const featureIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(FEATURE_ID_PATTERN, {
    message: () => "Feature IDs must use lowercase kebab-case.",
  }),
  Schema.brand("FeatureId"),
  Schema.annotations({
    description: "Stable public feature ID.",
  }),
);

export type FeatureId = Schema.Schema.Type<typeof featureIdSchema>;

const sourceDirectorySchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(SOURCE_DIRECTORY_PATTERN, {
    message: () => "Source directories must use camelCase.",
  }),
);

const shippedPathSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(FEATURE_RELATIVE_PATH_PATTERN, {
    message: () => "Shipped paths must stay inside the authored skill directory.",
  }),
);

const shippedPathsSchema = (request: { readonly duplicateMessage: string; readonly description: string }) =>
  Schema.Array(shippedPathSchema).pipe(
    Schema.filter((paths) => paths.length === new Set(paths).size, { message: () => request.duplicateMessage }),
    Schema.annotations({ description: request.description }),
  );

export const featurePlatformSchema = Schema.Literal("any", "macos", "macos+ghostty").annotations({
  description: "Host capability required by one selected feature.",
});

export const installedSkillSchema = Schema.TaggedStruct("skill", {
  id: Schema.NonEmptyTrimmedString.pipe(
    Schema.pattern(FEATURE_ID_PATTERN, {
      message: () => "Installed skill IDs must use lowercase kebab-case.",
    }),
    Schema.annotations({
      description: "Public directory name installed for this skill.",
    }),
  ),
  shippedPaths: shippedPathsSchema({
    duplicateMessage: "Shipped paths must be unique within one skill.",
    description: "Exact feature-relative allowlist copied into dist/skills.",
  }),
});

const installedSkillDefinitionSchema = Schema.Union(Schema.TaggedStruct("none", {}), installedSkillSchema);

const hookMatcherSchema = Schema.Union(
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("pattern", {
    value: Schema.NonEmptyTrimmedString.annotations({
      description: "Tool matcher pattern supplied to the agent hook registration.",
    }),
  }),
).annotations({
  description: "Optional tool matcher represented without an optional property.",
});

const registrationEntrypointSchema = Schema.Union(
  Schema.TaggedStruct("featureDefault", {}).annotations({
    description: "Use the feature-level hook sourceEntrypoint.",
  }),
  Schema.TaggedStruct("path", {
    value: Schema.NonEmptyTrimmedString.pipe(
      Schema.pattern(HOOK_SOURCE_ENTRYPOINT_PATTERN, {
        message: () => "Registration entrypoints must end in .ts and stay feature-relative.",
      }),
      Schema.annotations({
        description: "Feature-relative TypeScript entrypoint for this registration only.",
      }),
    ),
  }),
).annotations({
  description: "Per-registration entrypoint without an optional property.",
});

const hookRegistrationSchema = Schema.Struct({
  event: Schema.Literal(
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "SessionStart",
    "Stop",
    "PreCompact",
    "PostCompact",
    "SessionEnd",
  ).annotations({
    description: "Agent lifecycle event that invokes this entrypoint.",
  }),
  matcher: hookMatcherSchema,
  entrypoint: registrationEntrypointSchema,
  readsAgentId: Schema.Boolean.annotations({
    description:
      "Whether the hook reads AGENT_SETUP_AGENT_ID, so its command starts with AGENT_SETUP_AGENT_ID=<agent>.",
  }),
});

const featureRuntimeSchema = Schema.Union(
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("hook", {
    sourceEntrypoint: Schema.NonEmptyTrimmedString.pipe(
      Schema.pattern(HOOK_SOURCE_ENTRYPOINT_PATTERN, {
        message: () => "Hook source entrypoints must end in .ts and stay feature-relative.",
      }),
      Schema.annotations({
        description: "Feature-relative TypeScript entrypoint compiled into dist/src/hooks.",
      }),
    ),
    registrations: Schema.Array(hookRegistrationSchema).annotations({
      description: "Hook registrations derived into supported agent settings.",
    }),
  }),
);

export const featureDefinitionSchema = Schema.Struct({
  id: featureIdSchema.annotations({
    description: "Stable public feature ID.",
  }),
  sourceDirectory: sourceDirectorySchema.annotations({
    description: "Authored directory under src/skills.",
  }),
  installedSkill: installedSkillDefinitionSchema.annotations({
    description: "Installed output, separate from feature identity.",
  }),
  title: Schema.NonEmptyTrimmedString.annotations({
    description: "Short human-readable CLI label.",
  }),
  summary: Schema.NonEmptyTrimmedString.annotations({
    description: "One-line user-facing feature description.",
  }),
  selectedByDefault: Schema.Boolean.annotations({
    description: "Whether a fresh interactive install preselects the feature.",
  }),
  dependencies: Schema.Array(featureIdSchema).annotations({
    description: "Feature IDs resolved before this feature.",
  }),
  platform: featurePlatformSchema.annotations({
    description: "Host requirement surfaced by install and doctor.",
  }),
  runtime: featureRuntimeSchema.annotations({
    description: "Optional dependency-free hook runtime.",
  }),
});

export type FeatureDefinition = Schema.Schema.Type<typeof featureDefinitionSchema>;

const duplicateIssues = (request: {
  readonly values: ReadonlyArray<string | undefined>;
  readonly field: ReadonlyArray<string>;
  readonly message: string;
}) =>
  request.values.flatMap((value, index) =>
    value === undefined || request.values.indexOf(value) === index
      ? []
      : [{ path: [index, ...request.field], message: request.message }],
  );

const missingDependencyIssues = (features: ReadonlyArray<FeatureDefinition>) => {
  const featureIds = new Set(features.map((feature) => feature.id));

  return features.flatMap((feature, index) =>
    feature.dependencies.flatMap((dependency, dependencyIndex) =>
      featureIds.has(dependency)
        ? []
        : [
            {
              path: [index, "dependencies", dependencyIndex],
              message: "Dependencies must reference catalog features.",
            },
          ],
    ),
  );
};

const dependencyCycleIssues = (features: ReadonlyArray<FeatureDefinition>) => {
  const createsCycle = (id: FeatureId, path: ReadonlyArray<FeatureId>): boolean => {
    if (path.includes(id)) {
      return true;
    }

    const feature = features.find((candidate) => candidate.id === id);
    if (feature === undefined) {
      return false;
    }

    return feature.dependencies.some((dependency) => createsCycle(dependency, [...path, id]));
  };

  return features.flatMap((feature, index) =>
    createsCycle(feature.id, [])
      ? [{ path: [index, "dependencies"], message: "Feature dependencies must be acyclic." }]
      : [],
  );
};

const validateFeatureCatalog = (features: ReadonlyArray<FeatureDefinition>) => [
  ...duplicateIssues({
    values: features.map((feature) => feature.id),
    field: ["id"],
    message: "Feature IDs must be unique.",
  }),
  ...duplicateIssues({
    values: features.map((feature) => feature.sourceDirectory),
    field: ["sourceDirectory"],
    message: "Source directories must be unique.",
  }),
  ...duplicateIssues({
    values: features.map((feature) =>
      feature.installedSkill._tag === "skill" ? feature.installedSkill.id : undefined,
    ),
    field: ["installedSkill", "id"],
    message: "Installed skill IDs must be unique.",
  }),
  ...missingDependencyIssues(features),
  ...dependencyCycleIssues(features),
];

export const featureCatalogSchema = Schema.Array(featureDefinitionSchema).pipe(Schema.filter(validateFeatureCatalog));

// A copied skill: installed under its feature ID, never preselected, and without hook code.
const skillFeature = ({
  shippedPaths,
  dependencies = [],
  platform = "any",
  ...skill
}: {
  readonly id: string;
  readonly sourceDirectory: string;
  readonly title: string;
  readonly summary: string;
  readonly shippedPaths: ReadonlyArray<string>;
  readonly dependencies?: ReadonlyArray<string>;
  readonly platform?: Schema.Schema.Type<typeof featurePlatformSchema>;
}) => ({
  ...skill,
  installedSkill: { _tag: "skill", id: skill.id, shippedPaths },
  selectedByDefault: false,
  dependencies,
  platform,
  runtime: { _tag: "none" },
});

const idleCompactEvents = ["SessionStart", "UserPromptSubmit", "Stop", "PreCompact", "PostCompact", "SessionEnd"];

export const featureCatalog = Schema.decodeUnknownSync(featureCatalogSchema, { onExcessProperty: "error" })([
  {
    id: "context-guard",
    sourceDirectory: "contextGuard",
    installedSkill: { _tag: "none" },
    title: "Context guard",
    summary:
      "Guard long sessions near their context cap and optionally compact idle Claude Code, Codex, or Grok sessions in their exact Ghostty terminal.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
        ...idleCompactEvents.map((event) => ({
          event,
          matcher: { _tag: "none" },
          entrypoint: { _tag: "path", value: "hooks/recordIdleCompactEvent.ts" },
          readsAgentId: true,
        })),
      ],
    },
  },
  skillFeature({
    id: "autorun",
    sourceDirectory: "autorun",
    title: "Autorun",
    summary:
      "Let the agent keep working alone. When the context is almost full and a fresh handoff note exists, it runs /compact and continues the task. macOS + Ghostty only (it types into your terminal). The hook code lives in context-guard.",
    shippedPaths: ["SKILL.md", "agents"],
    dependencies: ["context-guard"],
    platform: "macos+ghostty",
  }),
  {
    id: "duplicate-code-guard",
    sourceDirectory: "duplicateCodeGuard",
    installedSkill: { _tag: "none" },
    title: "Duplicate code guard",
    summary:
      "Block a Write/Edit that pastes a function body or interface/type shape already defined elsewhere in the repo — DRY enforced at the moment of the write. Uses the repo's own TypeScript; blocks by default (tune with `agent-setup config set duplicate-code-mode warn`). Agents without edit hooks can run `agent-setup duplicates` as a pre-commit or CI check.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "scratch-folder-guard",
    sourceDirectory: "scratchFolderGuard",
    installedSkill: { _tag: "none" },
    title: "Scratch folder guard",
    summary:
      "Block every agent write into system temporary folders (/tmp, /private/tmp, /var/tmp, /dev/shm, $TMPDIR) — files, edits, shell redirects, copies, and mktemp — so logs and scratch files stay in a gitignored repo folder. When a turn ends with files left in the session's scratch folder, asks the agent to delete them once the user's tasks are finished, and deletes each ended Claude Code session's own scratch folder unless its subagents were still running.",
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "process-kill-guard",
    sourceDirectory: "processKillGuard",
    installedSkill: { _tag: "none" },
    title: "Process kill guard",
    summary:
      'Block pkill, killall, and pgrep-fed kill commands whose pattern would also stop a running Claude Code session, the terminal and shells it runs in, or an app in /Applications the pattern does not name — e.g. `pkill -f cat` matches every "/Applications" path and every session whose settings mention "notifications". The agent is told to kill only the pids it started.',
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "git-hook-guard",
    sourceDirectory: "gitHookGuard",
    installedSkill: { _tag: "none" },
    title: "Git hook guard",
    summary:
      "Block git commands that skip or disable git hooks (`--no-verify`, `git commit -n`, `HUSKY=0`, `core.hooksPath` overrides), and commits and pushes in a worktree whose hooks are not installed yet, e.g. a fresh worktree before `pnpm install`. The agent is told to fix what the hooks report instead.",
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "session-rehome",
    sourceDirectory: "sessionRehome",
    installedSkill: { _tag: "none" },
    title: "Session rehome",
    summary:
      "Move each ended Claude Code session and Codex thread into the repo it was about, so `/resume` and `codex resume` in that repo list it. Sessions started in ~/Desktop/Code, ~, /tmp, or a deleted worktree move when one repo clearly dominates their work; resuming a moved session from its old folder says where it went.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "disk-cleanup",
    sourceDirectory: "diskCleanup",
    installedSkill: { _tag: "none" },
    title: "Disk cleanup",
    summary:
      "When a Claude Code or Codex session ends, push and remove the finished git worktrees under your code folders that the session made or worked in: leftover changes are committed and every branch is kept. Worktrees another open session uses, made in the last hour, on the default branch, with secret or very large files, or whose push fails stay, and later session ends look at them again. Unpushed branches in the repos the session named are pushed to a branch of the same name, with the same limits, including ones checked out in a worktree it keeps or never looks at, unless an open session uses that folder. Once a day it also deletes Xcode build folders of gone projects, old Codex versions, and npx and act caches unused for two weeks, and runs the simulator, pnpm, and uv prunes. What each pass did, other than a dry run, is added to state/disk-cleanup/cleanup.log.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  skillFeature({
    id: "image-to-code",
    sourceDirectory: "imageToCode",
    title: "Image to code",
    summary:
      "Turn an image (PNG, screenshot, design) into code that looks the same — SVG, HTML/CSS, or animation — checked with pixel diffs.",
    shippedPaths: [
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
  }),
  skillFeature({
    id: "github-repo-about",
    sourceDirectory: "githubRepoAbout",
    title: "GitHub repo About",
    summary: 'Write the GitHub "About" box — a one-line description, a website link, and topics.',
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "write-blog-post",
    sourceDirectory: "writeBlogPost",
    title: "Write blog post (voice + cover)",
    summary:
      "Write a new portfolio blog post in the owner's voice, add it to the blog data file, and make a matching cover image in ChatGPT.",
    shippedPaths: ["SKILL.md", "agents"],
  }),
  skillFeature({
    id: "write-readme",
    sourceDirectory: "writeReadme",
    title: "Write README",
    summary:
      "Write or fix the README and other start-here docs. Reads the repo first, then asks you questions one by one.",
    shippedPaths: ["SKILL.md", "references"],
  }),
  skillFeature({
    id: "update-agent-docs",
    sourceDirectory: "updateAgentDocs",
    title: "Update agent docs",
    summary:
      "Create or update agent instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, and more) based on each agent's official docs.",
    shippedPaths: ["SKILL.md", "sources.json", "scripts"],
  }),
  skillFeature({
    id: "make-code-readable",
    sourceDirectory: "makeCodeReadable",
    title: "Make code readable",
    summary:
      "Make code easier to read — clearer names, files, and functions. Reviews first and shows before and after.",
    shippedPaths: ["SKILL.md", "references"],
  }),
  skillFeature({
    id: "simplify-code",
    sourceDirectory: "simplifyCode",
    title: "Simplify code",
    summary: "Remove extra code — wrappers, layers, folders, generic names, and scripts the job does not need.",
    shippedPaths: ["SKILL.md", "references"],
  }),
  skillFeature({
    id: "question-my-plan",
    sourceDirectory: "questionMyPlan",
    title: "Question my plan",
    summary:
      "Ask hard questions about your plan or design until you both understand it the same way, and keep the project docs up to date as you decide.",
    shippedPaths: ["SKILL.md"],
    dependencies: ["code-style"],
  }),
  skillFeature({
    id: "code-style",
    sourceDirectory: "codeStyle",
    title: "Code style",
    summary:
      "Make a repo follow the code-standard package: install its Biome and Ruff config, move the repo's own exceptions into AGENTS.md, set word swaps in LANGUAGE.md, run the safe fixes, and add a check to CI. Can also only score a repo.",
    shippedPaths: ["SKILL.md", "ADOPT.md", "NEW-PROJECT.md", "_shared"],
  }),
  skillFeature({
    id: "code-style-teach-me",
    sourceDirectory: "codeStyleTeachMe",
    title: "Code style — teach me",
    summary:
      "While you build, stop at each real choice, show two options, and explain the rule so you learn your own architecture.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "code-style-review",
    sourceDirectory: "codeStyleReview",
    title: "Code style review",
    summary:
      "Check a big change (branch or PR) against the style rules and get a short report, so you do not need to read every file.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "explain-my-stack",
    sourceDirectory: "explainMyStack",
    title: "Explain my stack",
    summary:
      "Understand why the project uses each technology (language, framework, services), with honest trade-offs and a plain glossary, all in chat.",
    shippedPaths: ["SKILL.md", "TEACH-FORMAT.md"],
  }),
  skillFeature({
    id: "plan-page",
    sourceDirectory: "planPage",
    title: "Plan page",
    summary:
      "Show a plan, approval step, or report as an interactive HTML page (open-source planpage package) where you can approve or change choices.",
    shippedPaths: ["SKILL.md", "COMPONENTS.md"],
  }),
  skillFeature({
    id: "website-speed-ci",
    sourceDirectory: "websiteSpeedCi",
    title: "Website speed CI",
    summary: "Add website speed checks (Lighthouse CI, Core Web Vitals, CrUX) to CI so a slow change fails the PR.",
    shippedPaths: ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "scripts", "templates"],
  }),
  skillFeature({
    id: "chrome-store-seo",
    sourceDirectory: "chromeStoreSeo",
    title: "Chrome Store SEO",
    summary:
      "Improve your Chrome Web Store text (name, summary, description) and landing page so more people find the extension.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "scripts", "templates"],
  }),
  skillFeature({
    id: "make-promo-video",
    sourceDirectory: "makePromoVideo",
    title: "Make promo video",
    summary:
      "Make a short promo video for a project — story, images, animation, voice, music, and a cut for each social app.",
    shippedPaths: ["SKILL.md", "reference", "scripts", "agents"],
    dependencies: ["plan-page"],
    platform: "macos",
  }),
  skillFeature({
    id: "check-website-quality",
    sourceDirectory: "checkWebsiteQuality",
    title: "Check website quality",
    summary:
      "Scan a website for HTML structure, accessibility, images, speed, security headers, SEO, and AI-readiness, then fix what is wrong.",
    shippedPaths: ["SKILL.md", "reference", "scripts", "templates"],
  }),
  skillFeature({
    id: "organize-commits",
    sourceDirectory: "organizeCommits",
    title: "Organize commits",
    summary: "Split your changes into small, clear commits with good messages, and clean up history and branches.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
  }),
  skillFeature({
    id: "finish-and-push",
    sourceDirectory: "finishAndPush",
    title: "Finish and push",
    summary: "Finish the work — run checks, commit, push to a feature branch, and clean up leftovers.",
    shippedPaths: ["SKILL.md"],
    dependencies: ["organize-commits"],
  }),
  skillFeature({
    id: "run-local-and-check",
    sourceDirectory: "runLocalAndCheck",
    title: "Run local and check",
    summary: "Run the app on your computer and prove it works in a real browser or app. No deploy.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "run-ci-locally",
    sourceDirectory: "runCiLocally",
    title: "Run CI locally",
    summary:
      "Run the repo's GitHub Actions workflows in Docker with act when Actions cannot run, then remove everything the run made.",
    shippedPaths: ["SKILL.md", "scripts"],
  }),
  skillFeature({
    id: "reuse-before-build",
    sourceDirectory: "reuseBeforeBuild",
    title: "Reuse before build",
    summary:
      "Before building a feature, find code, packages, or platform features you already have that can do the job.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "find-repeated-prompts",
    sourceDirectory: "findRepeatedPrompts",
    title: "Find repeated prompts",
    summary: "Read your past agent sessions and find prompts and work patterns you repeat, as ideas for new skills.",
    shippedPaths: ["SKILL.md", "scripts"],
  }),
  skillFeature({
    id: "install-skills",
    sourceDirectory: "installSkills",
    title: "Install skills",
    summary: "Install or update skills in all your coding agents and check that each agent can really find them.",
    shippedPaths: ["SKILL.md", "agents"],
  }),
  skillFeature({
    id: "fix-env-config",
    sourceDirectory: "fixEnvConfig",
    title: "Fix env config",
    summary:
      "Put env variables and config in one place with types and checks, and find duplicates, silent defaults, and secrets leaking to the client.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "add-mcp-server",
    sourceDirectory: "addMcpServer",
    title: "Add MCP server",
    summary: "Add an MCP server to your agents, log in with OAuth, and check that its tools really work.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "check-rtl-ui",
    sourceDirectory: "checkRtlUi",
    title: "Check RTL UI",
    summary:
      "Check and fix right-to-left screens (Hebrew, Arabic, Persian, Urdu) — layout, mixed-direction text, icons, forms, and accessibility.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "deploy-and-check",
    sourceDirectory: "deployAndCheck",
    title: "Deploy and check",
    summary: "Deploy to production and prove it is really live with checks against the real URL.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "fix-bug",
    sourceDirectory: "fixBug",
    title: "Fix bug",
    summary: "Reproduce the bug first, find the real cause, fix it, and prove the fix works.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "run-tasks-in-parallel",
    sourceDirectory: "runTasksInParallel",
    title: "Run tasks in parallel",
    summary: "Give a numbered task list, and each task gets its own agent, branch, tests, and PR.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
    dependencies: ["organize-commits", "finish-and-push", "run-local-and-check"],
  }),
  skillFeature({
    id: "ship-one-feature",
    sourceDirectory: "shipOneFeature",
    title: "Ship one feature",
    summary: "Take one feature or one GitHub issue all the way — branch, code, tests, PR, merge, and reinstall.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
    dependencies: ["run-tasks-in-parallel", "finish-and-push", "organize-commits"],
  }),
  skillFeature({
    id: "find-missing-tests",
    sourceDirectory: "findMissingTests",
    title: "Find missing tests",
    summary: "Find the tests each feature is missing (unit, mocks, integration, e2e), then write them test-first.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "references"],
    dependencies: ["run-tasks-in-parallel", "organize-commits", "finish-and-push"],
  }),
  skillFeature({
    id: "ship-missing-tests",
    sourceDirectory: "shipMissingTests",
    title: "Ship missing tests",
    summary: "Find missing tests in many features, fill them in parallel branches, and merge to main after checks.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "references", "agents"],
    dependencies: [
      "find-missing-tests",
      "clean-repo-by-feature",
      "run-tasks-in-parallel",
      "organize-commits",
      "finish-and-push",
      "ship-one-feature",
    ],
  }),
  skillFeature({
    id: "simplify-repo-with-tests",
    sourceDirectory: "simplifyRepoWithTests",
    title: "Simplify repo with tests",
    summary: "Find over-engineering across the repo, simplify it, and use tests to prove the behavior did not change.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "references", "agents"],
    dependencies: [
      "simplify-code",
      "run-tasks-in-parallel",
      "organize-commits",
      "finish-and-push",
      "find-missing-tests",
    ],
  }),
  skillFeature({
    id: "restructure-repo",
    sourceDirectory: "restructureRepo",
    title: "Restructure repo",
    summary:
      "Clean a whole repo — folders, names, code, and deps. It applies the no-AI code-standard fixes, scores the repo, shows one review page, then applies only the phases you approve on a branch.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "EXAMPLES.md"],
    dependencies: ["make-code-readable", "simplify-code"],
  }),
  skillFeature({
    id: "improve-ux",
    sourceDirectory: "improveUx",
    title: "Improve UX",
    summary:
      "Make user flows easier (fewer clicks, better layout, forms, mobile). Shows before/after designs first, then builds the one you pick.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
    dependencies: ["plan-page", "run-tasks-in-parallel", "finish-and-push", "organize-commits", "run-local-and-check"],
  }),
  skillFeature({
    id: "design-app-mockup",
    sourceDirectory: "designAppMockup",
    title: "Design app mockup",
    summary:
      "Turn an app idea into premium, Framer-level UI mockups: pick one of 3 real templates, get a hi-fi landing page inspired by it, or a close match in your own colors and content, then a UI library from that page, custom icons, real photos, and clickable app journeys.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "scripts"],
  }),
  skillFeature({
    id: "free-ports",
    sourceDirectory: "freePorts",
    title: "Free ports",
    summary: "Stop local servers that block ports (keeps Metro on 8081) so you can start dev again.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "clone-all-repos",
    sourceDirectory: "cloneAllRepos",
    title: "Clone all repos",
    summary: "Clone or update all your GitHub repos into your Code folder and report what changed.",
    shippedPaths: ["SKILL.md", "agents"],
  }),
  skillFeature({
    id: "manage-cloudflare",
    sourceDirectory: "manageCloudflare",
    title: "Manage Cloudflare",
    summary: "Set up and fix Cloudflare — wrangler config, D1, KV, R2, Workers and Pages projects, and secrets.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "clean-repo-by-feature",
    sourceDirectory: "cleanRepoByFeature",
    title: "Clean repo by feature",
    summary:
      "Back up main, then clean a messy project with one agent and one branch per feature, and open one PR per feature for you to review.",
    shippedPaths: ["SKILL.md", "agents"],
    dependencies: ["run-tasks-in-parallel", "finish-and-push", "organize-commits"],
  }),
  skillFeature({
    id: "add-skill",
    sourceDirectory: "addSkill",
    title: "Add skill",
    summary:
      "Describe a new skill and answer its questions; it shows the whole skill for approval, then adds, checks, and installs it.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
  }),
  skillFeature({
    id: "improve-skill",
    sourceDirectory: "improveSkill",
    title: "Improve skill",
    summary: "Change an existing skill based on feedback or on what went wrong in a real session.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "which-skill",
    sourceDirectory: "whichSkill",
    title: "Which skill",
    summary:
      "Not sure which skill to use? It turns your request into a short plan with the right skills and a ready prompt.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
  }),
  skillFeature({
    id: "benchmark-agents",
    sourceDirectory: "benchmarkAgents",
    title: "Benchmark agents",
    summary: "Run the same tasks with different agents, skills, or tools and compare tokens, time, cost, and success.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "agents", "scripts"],
  }),
  skillFeature({
    id: "release-mobile-app",
    sourceDirectory: "releaseMobileApp",
    title: "Release mobile app",
    summary:
      "Build and upload the app to App Store, TestFlight, or Google Play, and prove which commit, version, and build was sent.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "save-as-skill",
    sourceDirectory: "saveAsSkill",
    title: "Save as skill",
    summary: "Turn what we just did into something you can reuse — a skill, script, template, test, or runbook.",
    shippedPaths: ["SKILL.md"],
  }),
  skillFeature({
    id: "finish-old-sessions",
    sourceDirectory: "finishOldSessions",
    title: "Finish old sessions",
    summary:
      "Find unfinished work in past agent sessions, compare it with the repos, and finish each task or mark it honestly.",
    shippedPaths: ["SKILL.md", "agents"],
    dependencies: ["finish-and-push", "find-repeated-prompts"],
  }),
]);

// Features merged into another one. Receipts written before the merge still name the old ID.
export const retiredFeatureIds = new Map([
  ["code-style-new-project", "code-style"],
  ["code-style-existing-project", "code-style"],
  ["question-plan-with-docs", "question-my-plan"],
]);

export class UnknownFeatureError extends Schema.TaggedError<UnknownFeatureError>()("UnknownFeatureError", {
  featureId: Schema.String.annotations({
    description: "Unknown feature ID supplied by the caller.",
  }),
}) {
  get message(): string {
    return `Unknown feature: ${this.featureId}`;
  }
}

export const findFeature = (id: string): Option.Option<FeatureDefinition> =>
  Option.fromNullable(featureCatalog.find((feature) => feature.id === id));

export const defaultFeatureIds = featureCatalog
  .filter((feature) => feature.selectedByDefault)
  .map((feature) => feature.id);

export const addDependencies = (
  requestedIds: ReadonlyArray<string>,
): Either.Either<ReadonlyArray<FeatureId>, UnknownFeatureError> => {
  const unknownId = requestedIds.find((id) => Option.isNone(findFeature(id)));
  if (unknownId !== undefined) {
    return Either.left(new UnknownFeatureError({ featureId: unknownId }));
  }

  const resolvedIds = new Set<string>();
  // The catalog schema already proves every dependency exists and the graph is acyclic.
  const visitFeature = (feature: FeatureDefinition): void => {
    if (resolvedIds.has(feature.id)) {
      return;
    }

    resolvedIds.add(feature.id);
    featureCatalog.filter((candidate) => feature.dependencies.includes(candidate.id)).forEach(visitFeature);
  };
  featureCatalog.filter((feature) => requestedIds.includes(feature.id)).forEach(visitFeature);

  return Either.right(featureCatalog.filter((feature) => resolvedIds.has(feature.id)).map((feature) => feature.id));
};

export const skillsForFeatures = (featureIds: ReadonlyArray<FeatureId>) =>
  featureCatalog.flatMap((feature) =>
    featureIds.includes(feature.id) && feature.installedSkill._tag === "skill" ? [feature.installedSkill] : [],
  );
