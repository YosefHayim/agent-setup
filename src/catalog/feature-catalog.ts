import { z } from "zod";

import { nonEmptyTrimmedTextSchema } from "#src/install/text-rules.js";

// e.g. "scratch-folder-guard", "image-to-code" — not "ScratchFolderGuard" or "png_to_code"
const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// e.g. "SKILL.md", "watchers/cleanup-watcher.ts" — not "/abs/path" or "a/../b"
const FEATURE_RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/;
// e.g. "hooks/scratch-folder-guard.ts" — feature-relative hook entrypoint only
const HOOK_ORIGIN_ENTRYPOINT_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+\.ts$/;

export const featureIdSchema = nonEmptyTrimmedTextSchema
  .regex(FEATURE_ID_PATTERN, "Feature IDs must use lowercase kebab-case.")
  .brand<"FeatureId">()
  .describe("Stable public feature ID.");

export type FeatureId = z.infer<typeof featureIdSchema>;

const originDirectorySchema = nonEmptyTrimmedTextSchema.regex(
  FEATURE_ID_PATTERN,
  "Source directories must use kebab-case.",
);

const shippedPathSchema = nonEmptyTrimmedTextSchema.regex(
  FEATURE_RELATIVE_PATH_PATTERN,
  "Shipped paths must stay inside the authored skill directory.",
);

const readShippedPathsSchema = (request: { readonly duplicateMessage: string; readonly description: string }) =>
  z
    .array(shippedPathSchema)
    .refine((paths) => paths.length === new Set(paths).size, { message: request.duplicateMessage })
    .describe(request.description);

export const featurePlatformSchema = z
  .enum(["any", "macos"])
  .describe("Host capability required by one selected feature.");

export const installedSkillSchema = z
  .strictObject({
    _tag: z.literal("skill"),
    id: nonEmptyTrimmedTextSchema
      .regex(FEATURE_ID_PATTERN, "Installed skill IDs must use lowercase kebab-case.")
      .describe("Public directory name installed for this skill."),
    shippedPaths: readShippedPathsSchema({
      duplicateMessage: "Shipped paths must be unique within one skill.",
      description: "Exact feature-relative allowlist copied into dist/skills.",
    }),
  })
  .describe("Installed skill output.");

const installedSkillDefinitionSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("none") }),
  installedSkillSchema,
]);

const hookMatcherSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("none") }),
    z.strictObject({
      _tag: z.literal("pattern"),
      value: nonEmptyTrimmedTextSchema.describe("Tool matcher pattern supplied to the agent hook registration."),
    }),
  ])
  .describe("Optional tool matcher represented without an optional property.");

const registrationEntrypointSchema = z
  .discriminatedUnion("_tag", [
    z.strictObject({ _tag: z.literal("featureDefault") }).describe("Use the feature-level hook sourceEntrypoint."),
    z.strictObject({
      _tag: z.literal("path"),
      value: nonEmptyTrimmedTextSchema
        .regex(HOOK_ORIGIN_ENTRYPOINT_PATTERN, "Registration entrypoints must end in .ts and stay feature-relative.")
        .describe("Feature-relative TypeScript entrypoint for this registration only."),
    }),
  ])
  .describe("Per-registration entrypoint without an optional property.");

const hookRegistrationSchema = z.strictObject({
  event: z
    .enum([
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "SessionStart",
      "SubagentStart",
      "Stop",
      "SubagentStop",
      "PreCompact",
      "PostCompact",
      "SessionEnd",
    ])
    .describe("Agent lifecycle event that invokes this entrypoint."),
  matcher: hookMatcherSchema,
  entrypoint: registrationEntrypointSchema,
  readsAgentId: z
    .boolean()
    .describe("Whether the hook reads AGENT_SETUP_AGENT_ID, so its command starts with AGENT_SETUP_AGENT_ID=<agent>."),
  runsInBackground: z
    .boolean()
    .describe(
      "Whether Claude Code runs the hook without waiting for it (async true). Only for hooks that print nothing the agent needs.",
    )
    .optional(),
});

const featureRuntimeSchema = z.discriminatedUnion("_tag", [
  z.strictObject({ _tag: z.literal("none") }),
  z.strictObject({
    _tag: z.literal("hook"),
    sourceEntrypoint: nonEmptyTrimmedTextSchema
      .regex(HOOK_ORIGIN_ENTRYPOINT_PATTERN, "Hook source entrypoints must end in .ts and stay feature-relative.")
      .describe("Feature-relative TypeScript entrypoint compiled into dist/src/hooks."),
    registrations: z
      .array(hookRegistrationSchema)
      .describe("Hook registrations derived into supported agent settings."),
  }),
]);

const featureDefinitionSchema = z.strictObject({
  id: featureIdSchema.describe("Stable public feature ID."),
  sourceDirectory: originDirectorySchema.describe("Authored directory under src/skills."),
  installedSkill: installedSkillDefinitionSchema.describe("Installed output, separate from feature identity."),
  title: nonEmptyTrimmedTextSchema.describe("Short human-readable CLI label."),
  summary: nonEmptyTrimmedTextSchema.describe("One-line user-facing feature description."),
  selectedByDefault: z.boolean().describe("Whether a fresh interactive install preselects the feature."),
  dependencies: z.array(featureIdSchema).describe("Feature IDs resolved before this feature."),
  platform: featurePlatformSchema.describe("Host requirement surfaced by install and doctor."),
  runtime: featureRuntimeSchema.describe("Optional dependency-free hook runtime."),
});

export type FeatureDefinition = z.infer<typeof featureDefinitionSchema>;

export type FeaturePlatform = z.infer<typeof featurePlatformSchema>;

interface CatalogIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

const listDuplicateIssues = (request: {
  readonly values: ReadonlyArray<string | null>;
  readonly field: ReadonlyArray<string>;
  readonly message: string;
}): ReadonlyArray<CatalogIssue> =>
  request.values.flatMap((member, index) => {
    const isMissingMember = member == null;
    const isFirstWithThisMember = request.values.indexOf(member) === index;

    const isSkippedMember = isMissingMember || isFirstWithThisMember;

    if (isSkippedMember) {
      return [];
    }

    return [{ path: [index, ...request.field], message: request.message }];
  });

const listMissingDependencyIssues = (features: ReadonlyArray<FeatureDefinition>): ReadonlyArray<CatalogIssue> => {
  const featureIds = new Set(features.map((feature) => feature.id));

  return features.flatMap((feature, index) =>
    feature.dependencies.flatMap((dependency, dependencyIndex) => {
      const isKnownDependency = featureIds.has(dependency);

      if (isKnownDependency) {
        return [];
      }

      return [
        {
          path: [index, "dependencies", dependencyIndex],
          message: "Dependencies must reference catalog features.",
        },
      ];
    }),
  );
};

const listDependencyCycleIssues = (features: ReadonlyArray<FeatureDefinition>): ReadonlyArray<CatalogIssue> => {
  const isCreatingCycle = (id: FeatureId, path: ReadonlyArray<FeatureId>): boolean => {
    const isIdOnPath = path.includes(id);

    if (isIdOnPath) {
      return true;
    }

    const feature = features.find((candidate) => candidate.id === id);

    const isFeatureMissing = feature == null;
    if (isFeatureMissing) {
      return false;
    }

    return feature.dependencies.some((dependency) => isCreatingCycle(dependency, [...path, id]));
  };

  return features.flatMap((feature, index) => {
    const isThereCycle = isCreatingCycle(feature.id, []);

    if (isThereCycle) {
      return [{ path: [index, "dependencies"], message: "Feature dependencies must be acyclic." }];
    }

    return [];
  });
};

const validateFeatureCatalog = (features: ReadonlyArray<FeatureDefinition>): ReadonlyArray<CatalogIssue> => [
  ...listDuplicateIssues({
    values: features.map((feature) => feature.id),
    field: ["id"],
    message: "Feature IDs must be unique.",
  }),
  ...listDuplicateIssues({
    values: features.map((feature) => feature.sourceDirectory),
    field: ["sourceDirectory"],
    message: "Source directories must be unique.",
  }),
  ...listDuplicateIssues({
    values: features.map((feature) => {
      const installedSkill = feature.installedSkill;
      const isSkillInstalled = installedSkill._tag === "skill";

      if (isSkillInstalled) {
        return installedSkill.id;
      }

      return null;
    }),
    field: ["installedSkill", "id"],
    message: "Installed skill IDs must be unique.",
  }),
  ...listMissingDependencyIssues(features),
  ...listDependencyCycleIssues(features),
];

export const featureCatalogSchema = z.array(featureDefinitionSchema).superRefine((features, refinement) => {
  for (const issue of validateFeatureCatalog(features)) {
    refinement.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
  }
});

// A copied skill: installed under its feature ID, never preselected, and without hook code.
const readSkillFeature = ({
  shippedPaths,
  dependencies: collaborators = [],
  platform = "any",
  ...skill
}: {
  readonly id: string;
  readonly sourceDirectory: string;
  readonly title: string;
  readonly summary: string;
  readonly shippedPaths: ReadonlyArray<string>;
  readonly dependencies?: ReadonlyArray<string>;
  readonly platform?: FeaturePlatform;
}) => ({
  ...skill,
  installedSkill: { _tag: "skill", id: skill.id, shippedPaths },
  selectedByDefault: false,
  dependencies: collaborators,
  platform,
  runtime: { _tag: "none" },
});

export const featureCatalog: ReadonlyArray<FeatureDefinition> = featureCatalogSchema.parse([
  {
    id: "active-run-reminder",
    sourceDirectory: "active-run-reminder",
    installedSkill: { _tag: "none" },
    title: "Active run reminder",
    summary:
      "When a Claude Code session or subagent starts in a repo with an active run, tell it to read the run's spec first. Reads the active-run.json pointer that the run-tasks-in-parallel skill writes. Does nothing when there is no run.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "scratch-folder-guard",
    sourceDirectory: "scratch-folder-guard",
    installedSkill: { _tag: "none" },
    title: "Scratch folder guard",
    summary:
      "Block every agent write into system temporary folders (/tmp, /private/tmp, /var/tmp, /dev/shm, $TMPDIR) — files, edits, shell redirects, copies, and mktemp — so logs and scratch files stay in a gitignored repo folder. When a turn ends with files left in the session's scratch folder, asks the agent to delete them once the user's tasks are finished, and deletes each ended Claude Code session's own scratch folder unless its subagents were still running.",
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "process-kill-guard",
    sourceDirectory: "process-kill-guard",
    installedSkill: { _tag: "none" },
    title: "Process kill guard",
    summary:
      'Block pkill, killall, and pgrep-fed kill commands whose pattern would also stop a running Claude Code session, the terminal and shells it runs in, or an app in /Applications the pattern does not name — e.g. `pkill -f cat` matches every "/Applications" path and every session whose settings mention "notifications". The agent is told to kill only the pids it started.',
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "git-hook-guard",
    sourceDirectory: "git-hook-guard",
    installedSkill: { _tag: "none" },
    title: "Git hook guard",
    summary:
      "Block git commands that skip or disable git hooks (`--no-verify`, `git commit -n`, `HUSKY=0`, `core.hooksPath` overrides), and commits and pushes in a worktree whose hooks are not installed yet, e.g. a fresh worktree before `pnpm install`. The agent is told to fix what the hooks report instead.",
    selectedByDefault: true,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "session-rehome",
    sourceDirectory: "session-rehome",
    installedSkill: { _tag: "none" },
    title: "Session rehome",
    summary:
      "Move each ended Claude Code session and Codex thread into the repo it was about, so `/resume` and `codex resume` in that repo list it. Sessions started in ~/Desktop/Code, ~, /tmp, or a deleted worktree move when one repo clearly dominates their work; resuming a moved session from its old folder says where it went.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "disk-cleanup",
    sourceDirectory: "disk-cleanup",
    installedSkill: { _tag: "none" },
    title: "Disk cleanup",
    summary:
      "When a Claude Code or Codex session ends, push and remove the finished git worktrees under your code folders that the session made or worked in: leftover changes are committed and every branch is kept. Worktrees another open session uses, made in the last hour, on the default branch, with secret or very large files, or whose push fails stay, and later session ends look at them again. Unpushed branches in the repos the session named are pushed to a branch of the same name, with the same limits, including ones checked out in a worktree it keeps or never looks at, unless an open session uses that folder. Once a day it also deletes Xcode build folders of gone projects, old Codex versions, and npx and act caches unused for two weeks, and runs the simulator, pnpm, and uv prunes. What each pass did, other than a dry run, is added to state/disk-cleanup/cleanup.log.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  {
    id: "leftover-process-cleanup",
    sourceDirectory: "leftover-process-cleanup",
    installedSkill: { _tag: "none" },
    title: "Leftover process cleanup",
    summary:
      "At the end of a turn and when a subagent stops, quietly stop the servers and test browsers that agents left running. It stops a process whose working folder is gone and was under your code folders, e.g. a vite preview or wrangler dev started in a worktree that was removed, and a test browser (Lighthouse, Playwright, Puppeteer) whose temporary profile folder it was left with and that is orphaned and over an hour old. It never stops your own Chrome, Docker, VS Code, shells, Claude Code sessions, or work in a folder that still exists. Each stopped process is added as one line to ~/.local/state/agent-setup/leftover-process-cleanup.log. SubagentStop is registered for Claude Code only.",
    selectedByDefault: false,
    dependencies: [],
    platform: "any",
    runtime: {
      _tag: "hook",
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
  },
  readSkillFeature({
    id: "image-to-code",
    sourceDirectory: "image-to-code",
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
  readSkillFeature({
    id: "github-repo-about",
    sourceDirectory: "github-repo-about",
    title: "GitHub repo About",
    summary: 'Write the GitHub "About" box — a one-line description, a website link, and topics.',
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "write-blog-post",
    sourceDirectory: "write-blog-post",
    title: "Write blog post (voice + cover)",
    summary:
      "Write a new portfolio blog post in the owner's voice, add it to the blog data file, and make a matching cover image in ChatGPT.",
    shippedPaths: ["SKILL.md", "agents"],
  }),
  readSkillFeature({
    id: "write-readme",
    sourceDirectory: "write-readme",
    title: "Write README",
    summary:
      "Write or fix the README and other start-here docs. Reads the repo first, then asks you questions one by one.",
    shippedPaths: ["SKILL.md", "references"],
  }),
  readSkillFeature({
    id: "update-agent-docs",
    sourceDirectory: "update-agent-docs",
    title: "Update agent docs",
    summary:
      "Create or update agent instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, and more) based on each agent's official docs.",
    shippedPaths: ["SKILL.md", "sources.json", "scripts"],
  }),
  readSkillFeature({
    id: "make-code-readable",
    sourceDirectory: "make-code-readable",
    title: "Make code readable",
    summary:
      "Make code easier to read — clearer names, files, and functions. Reviews first and shows before and after.",
    shippedPaths: ["SKILL.md", "references"],
  }),
  readSkillFeature({
    id: "simplify-code",
    sourceDirectory: "simplify-code",
    title: "Simplify code",
    summary: "Remove extra code — wrappers, layers, folders, generic names, and scripts the job does not need.",
    shippedPaths: ["SKILL.md", "references"],
  }),
  readSkillFeature({
    id: "question-my-plan",
    sourceDirectory: "question-my-plan",
    title: "Question my plan",
    summary:
      "Ask hard questions about your plan or design until you both understand it the same way, and keep the project docs up to date as you decide.",
    shippedPaths: ["SKILL.md"],
    dependencies: ["code-style"],
  }),
  readSkillFeature({
    id: "ask-before-build",
    sourceDirectory: "ask-before-build",
    title: "Ask before build",
    summary:
      "Ask every open question about a new task up front, cut it to an MVP, and backlog the rest, so scope does not arrive one message at a time.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "code-style",
    sourceDirectory: "code-style",
    title: "Code style",
    summary:
      "Make a repo follow the personal rules in ~/.claude/rules/: set up Biome and Ruff, move the repo's own exceptions into AGENTS.md, line up folders, file names and root docs, and fix the code. Can also only review a repo.",
    shippedPaths: ["SKILL.md", "ADOPT.md", "NEW-PROJECT.md", "_shared"],
  }),
  readSkillFeature({
    id: "code-style-teach-me",
    sourceDirectory: "code-style-teach-me",
    title: "Code style — teach me",
    summary:
      "While you build, stop at each real choice, show two options, and explain the rule so you learn your own architecture.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "code-style-review",
    sourceDirectory: "code-style-review",
    title: "Code style review",
    summary:
      "Check a big change (branch or PR) against the style rules and get a short report, so you do not need to read every file.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "explain-my-stack",
    sourceDirectory: "explain-my-stack",
    title: "Explain my stack",
    summary:
      "Understand why the project uses each technology (language, framework, services), with honest trade-offs and a plain glossary, all in chat.",
    shippedPaths: ["SKILL.md", "TEACH-FORMAT.md"],
  }),
  readSkillFeature({
    id: "plan-page",
    sourceDirectory: "plan-page",
    title: "Plan page",
    summary:
      "Show a plan, approval step, or report as an interactive HTML page (open-source planpage package) where you can approve or change choices.",
    shippedPaths: ["SKILL.md", "COMPONENTS.md"],
  }),
  readSkillFeature({
    id: "website-speed-ci",
    sourceDirectory: "website-speed-ci",
    title: "Website speed CI",
    summary: "Add website speed checks (Lighthouse CI, Core Web Vitals, CrUX) to CI so a slow change fails the PR.",
    shippedPaths: ["SKILL.md", "README.md", "CONTEXT.md", "TECH-GLOSSARY.md", "reference", "scripts", "templates"],
  }),
  readSkillFeature({
    id: "chrome-store-seo",
    sourceDirectory: "chrome-store-seo",
    title: "Chrome Store SEO",
    summary:
      "Improve your Chrome Web Store text (name, summary, description) and landing page so more people find the extension.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "scripts", "templates"],
  }),
  readSkillFeature({
    id: "make-promo-video",
    sourceDirectory: "make-promo-video",
    title: "Make promo video",
    summary:
      "Make a short promo video for a project — story, images, animation, voice, music, and a cut for each social app.",
    shippedPaths: ["SKILL.md", "reference", "scripts", "agents"],
    dependencies: ["plan-page"],
    platform: "macos",
  }),
  readSkillFeature({
    id: "check-website-quality",
    sourceDirectory: "check-website-quality",
    title: "Check website quality",
    summary:
      "Scan a website for HTML structure, accessibility, images, speed, security headers, SEO, and AI-readiness, then fix what is wrong.",
    shippedPaths: ["SKILL.md", "reference", "scripts", "templates"],
  }),
  readSkillFeature({
    id: "organize-commits",
    sourceDirectory: "organize-commits",
    title: "Organize commits",
    summary: "Split your changes into small, clear commits with good messages, and clean up history and branches.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
  }),
  readSkillFeature({
    id: "finish-and-push",
    sourceDirectory: "finish-and-push",
    title: "Finish and push",
    summary: "Finish the work — run checks, commit, push to a feature branch, and clean up leftovers.",
    shippedPaths: ["SKILL.md"],
    dependencies: ["organize-commits"],
  }),
  readSkillFeature({
    id: "run-local-and-check",
    sourceDirectory: "run-local-and-check",
    title: "Run local and check",
    summary: "Run the app on your computer and prove it works in a real browser or app. No deploy.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "run-ci-locally",
    sourceDirectory: "run-ci-locally",
    title: "Run CI locally",
    summary:
      "Run the repo's GitHub Actions workflows in Docker with act when Actions cannot run, then remove everything the run made.",
    shippedPaths: ["SKILL.md", "scripts"],
  }),
  readSkillFeature({
    id: "reuse-before-build",
    sourceDirectory: "reuse-before-build",
    title: "Reuse before build",
    summary:
      "Before building a feature, find code, packages, or platform features you already have that can do the job.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "find-repeated-prompts",
    sourceDirectory: "find-repeated-prompts",
    title: "Find repeated prompts",
    summary: "Read your past agent sessions and find prompts and work patterns you repeat, as ideas for new skills.",
    shippedPaths: ["SKILL.md", "scripts"],
  }),
  readSkillFeature({
    id: "install-skills",
    sourceDirectory: "install-skills",
    title: "Install skills",
    summary: "Install or update skills in all your coding agents and check that each agent can really find them.",
    shippedPaths: ["SKILL.md", "agents"],
  }),
  readSkillFeature({
    id: "fix-env-config",
    sourceDirectory: "fix-env-config",
    title: "Fix env config",
    summary:
      "Put env variables and config in one place with types and checks, and find duplicates, silent defaults, and secrets leaking to the client.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "add-mcp-server",
    sourceDirectory: "add-mcp-server",
    title: "Add MCP server",
    summary: "Add an MCP server to your agents, log in with OAuth, and check that its tools really work.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "check-rtl-ui",
    sourceDirectory: "check-rtl-ui",
    title: "Check RTL UI",
    summary:
      "Check and fix right-to-left screens (Hebrew, Arabic, Persian, Urdu) — layout, mixed-direction text, icons, forms, and accessibility.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "deploy-and-check",
    sourceDirectory: "deploy-and-check",
    title: "Deploy and check",
    summary: "Deploy to production and prove it is really live with checks against the real URL.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "fix-bug",
    sourceDirectory: "fix-bug",
    title: "Fix bug",
    summary: "Reproduce the bug first, find the real cause, fix it, and prove the fix works.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "run-tasks-in-parallel",
    sourceDirectory: "run-tasks-in-parallel",
    title: "Run tasks in parallel",
    summary: "Give a numbered task list, and each task gets its own agent, branch, tests, and PR.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
    dependencies: ["organize-commits", "finish-and-push", "run-local-and-check", "active-run-reminder"],
  }),
  readSkillFeature({
    id: "ship-one-feature",
    sourceDirectory: "ship-one-feature",
    title: "Ship one feature",
    summary: "Take one feature or one GitHub issue all the way — branch, code, tests, PR, merge, and reinstall.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
    dependencies: ["run-tasks-in-parallel", "finish-and-push", "organize-commits"],
  }),
  readSkillFeature({
    id: "find-missing-tests",
    sourceDirectory: "find-missing-tests",
    title: "Find missing tests",
    summary: "Find the tests each feature is missing (unit, mocks, integration, e2e), then write them test-first.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "references"],
    dependencies: ["run-tasks-in-parallel", "organize-commits", "finish-and-push"],
  }),
  readSkillFeature({
    id: "ship-missing-tests",
    sourceDirectory: "ship-missing-tests",
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
  readSkillFeature({
    id: "simplify-repo-with-tests",
    sourceDirectory: "simplify-repo-with-tests",
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
  readSkillFeature({
    id: "restructure-repo",
    sourceDirectory: "restructure-repo",
    title: "Restructure repo",
    summary:
      "Clean a whole repo — folders, names, code, and deps. It applies the safe fixes, scans the repo against the personal rules, shows one review page, then applies only the phases you approve on a branch.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "EXAMPLES.md"],
    dependencies: ["make-code-readable", "simplify-code"],
  }),
  readSkillFeature({
    id: "improve-ux",
    sourceDirectory: "improve-ux",
    title: "Improve UX",
    summary:
      "Make user flows easier (fewer clicks, better layout, forms, mobile). Shows before/after designs first, then builds the one you pick.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
    dependencies: ["plan-page", "run-tasks-in-parallel", "finish-and-push", "organize-commits", "run-local-and-check"],
  }),
  readSkillFeature({
    id: "design-app-mockup",
    sourceDirectory: "design-app-mockup",
    title: "Design app mockup",
    summary:
      "Turn an app idea into premium, Framer-level UI mockups: pick one of 3 real templates, get a hi-fi landing page inspired by it, or a close match in your own colors and content, then a UI library from that page, custom icons, real photos, and clickable app journeys.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "scripts"],
  }),
  readSkillFeature({
    id: "free-ports",
    sourceDirectory: "free-ports",
    title: "Free ports",
    summary: "Stop local servers that block ports (keeps Metro on 8081) so you can start dev again.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "clone-all-repos",
    sourceDirectory: "clone-all-repos",
    title: "Clone all repos",
    summary: "Clone or update all your GitHub repos into your Code folder and report what changed.",
    shippedPaths: ["SKILL.md", "agents"],
  }),
  readSkillFeature({
    id: "manage-cloudflare",
    sourceDirectory: "manage-cloudflare",
    title: "Manage Cloudflare",
    summary: "Set up and fix Cloudflare — wrangler config, D1, KV, R2, Workers and Pages projects, and secrets.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "clean-repo-by-feature",
    sourceDirectory: "clean-repo-by-feature",
    title: "Clean repo by feature",
    summary:
      "Back up main, then clean a messy project with one agent and one branch per feature, and open one PR per feature for you to review.",
    shippedPaths: ["SKILL.md", "agents"],
    dependencies: ["run-tasks-in-parallel", "finish-and-push", "organize-commits"],
  }),
  readSkillFeature({
    id: "add-skill",
    sourceDirectory: "add-skill",
    title: "Add skill",
    summary:
      "Describe a new skill and answer its questions; it shows the whole skill for approval, then adds, checks, and installs it.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
  }),
  readSkillFeature({
    id: "improve-skill",
    sourceDirectory: "improve-skill",
    title: "Improve skill",
    summary: "Change an existing skill based on feedback or on what went wrong in a real session.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "which-skill",
    sourceDirectory: "which-skill",
    title: "Which skill",
    summary:
      "Not sure which skill to use? It turns your request into a short plan with the right skills and a ready prompt.",
    shippedPaths: ["SKILL.md", "REFERENCE.md"],
  }),
  readSkillFeature({
    id: "benchmark-agents",
    sourceDirectory: "benchmark-agents",
    title: "Benchmark agents",
    summary: "Run the same tasks with different agents, skills, or tools and compare tokens, time, cost, and success.",
    shippedPaths: ["SKILL.md", "REFERENCE.md", "agents", "scripts"],
  }),
  readSkillFeature({
    id: "release-mobile-app",
    sourceDirectory: "release-mobile-app",
    title: "Release mobile app",
    summary:
      "Build and upload the app to App Store, TestFlight, or Google Play, and prove which commit, version, and build was sent.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "save-as-skill",
    sourceDirectory: "save-as-skill",
    title: "Save as skill",
    summary: "Turn what we just did into something you can reuse — a skill, script, template, test, or runbook.",
    shippedPaths: ["SKILL.md"],
  }),
  readSkillFeature({
    id: "finish-old-sessions",
    sourceDirectory: "finish-old-sessions",
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

export const findFeature = (id: string): FeatureDefinition | null =>
  featureCatalog.find((feature) => feature.id === id) ?? null;

export const defaultFeatureIds = featureCatalog
  .filter((feature) => feature.selectedByDefault)
  .map((feature) => feature.id);

export type AddCollaboratorsReport =
  | { readonly status: "ready"; readonly featureIds: ReadonlyArray<FeatureId> }
  | { readonly status: "unknown"; readonly featureId: string };

// Adds every dependency of the requested features. An unknown requested ID is a status, not a throw.
export const addDependencies = (requestedIds: ReadonlyArray<string>): AddCollaboratorsReport => {
  const unknownId = requestedIds.find((id) => findFeature(id) === null);

  const isThereUnknownId = unknownId != null;
  if (isThereUnknownId) {
    return { status: "unknown", featureId: unknownId };
  }

  const includedIds = new Set<string>();
  // The catalog schema already proves every dependency exists and the graph is acyclic.
  const visitFeature = (feature: FeatureDefinition): void => {
    const isAlreadyIncluded = includedIds.has(feature.id);

    if (isAlreadyIncluded) {
      return;
    }

    includedIds.add(feature.id);
    featureCatalog.filter((candidate) => feature.dependencies.includes(candidate.id)).forEach(visitFeature);
  };
  featureCatalog.filter((feature) => requestedIds.includes(feature.id)).forEach(visitFeature);

  const featureIds = featureCatalog.filter((feature) => includedIds.has(feature.id)).map((feature) => feature.id);
  return { status: "ready", featureIds };
};

export const skillsForFeatures = (featureIds: ReadonlyArray<FeatureId>) =>
  featureCatalog.flatMap((feature) => {
    const isFeatureRequested = featureIds.includes(feature.id);
    const installedSkill = feature.installedSkill;
    const isSkillInstalled = installedSkill._tag === "skill";

    const isSkillRequested = isFeatureRequested && isSkillInstalled;

    if (isSkillRequested) {
      return [installedSkill];
    }

    return [];
  });
