# AGENTS.md

Entrypoint for coding agents and maintainers. Claude Code, Codex, Cursor, Kiro, and other AGENTS-aware tools read this file directly. Gemini CLI reads it when its `context.fileName` setting includes `AGENTS.md`.

## What this is

**agent-setup** is a TypeScript CLI that installs, updates, uninstalls, diagnoses, configures, and scaffolds an owned set of agent skills, dependency-free hooks, agent configuration, and copyable single-gate CI/publish workflow templates.

```bash
npx agent-setup install image-to-code
```

Voice lives in **agent-voice** and free provider routing in **free-model-router**, each in its own repository. Do not add either back here.

## Source-of-truth map

Read these before changing code. This file is a routing digest — open the linked SSOT for details.

| Doc | Role |
| --- | --- |
| [`PROJECT.md`](PROJECT.md) | Product scope and direction |
| [`CONTEXT.md`](CONTEXT.md) | Runtime and operational boundaries |
| [`LANGUAGE.md`](LANGUAGE.md) | Domain terms |
| [`CODE-STYLE.md`](CODE-STYLE.md) | Prescriptive style SSOT for this repo |
| `src/skills/<sourceDirectory>/` | Authored skill payload, shipped verbatim |
| `src/hooks/<sourceDirectory>/` | Feature-local executable hook code |
| [`README.md` → Settings](README.md#settings) | Every setting and environment variable (generated) |

Public feature and installed-skill IDs are decoded catalog data and can differ from the authored camelCase directory name.

**Style layers:** workspace philosophy ships as [`src/templates/projectDocs/CODE-STYLE.md`](src/templates/projectDocs/CODE-STYLE.md) (Uncle Bob distillation) → this repo’s [`CODE-STYLE.md`](CODE-STYLE.md) **wins on mechanism**. Philosophy still binds on intent (small functions, honest names, dependency direction, tests as courage). Do not restate style rules here.

**Rule cards:** every rule in `CODE-STYLE.md` is one card — heading, `[rule:<id>] · verify: <command>`, a **one-sentence** assertion, a ✓/✗ example, a `Why:` line. The cards are the only rule index — there is no JSON mirror. `src/scripts/checkRuleCards.ts` fails `pnpm verify` when a card drifts, so add rules by following [`CODE-STYLE.md`](CODE-STYLE.md) → Recipes → "Adding a rule to this document".

## Repo layout

| Path | Ownership |
| --- | --- |
| `src/cli/` | Effect CLI definitions (one file per command, named after it) and `TerminalUI` presentation |
| `src/catalog/` | Decoded feature and agent catalogs |
| `src/config/` | Schema-owned managed configuration (`configSchema.ts`), config.json bytes and install plan (`configFile.ts`), one scope's config read and save (`scopeConfig.ts`), host scan (`hostScan.ts`), and the list of every environment variable (`environmentVariables.ts`) |
| `src/install/` | Install planning, package preparation, transactional apply, receipts, and agent formats |
| `src/hooks/lib/` | Dependency-free code shared by every installed hook: `hookConfig` (config.json and install root), `hookOutput` (hook decisions on stdout), `processAlive` (is a pid running), `transcriptReader` (agent transcript lines), `claudeLiveSessions` (which Claude Code sessions are running, and their pids), `claudeJobs` (the state of each Claude Code background job), `claudeSubagents` (whether a session's subagents are still running), `claudeScratchRoots` (where Claude Code keeps session scratch folders), `codexHome` (where Codex keeps its files), `jsonLines` (JSON-lines files), `sessionIds` (session ids from hook input), `sessionEvidence` (the folders and repos a transcript worked in), `pathMatcher` (which named folders a text mentions), `patternEscape` (text as a literal regex), `codeRepos` (git repos under the code folders), `gitAnswers` (git calls and their output lines), `detachedWatcher` (start a watcher that outlives its hook), `watcherLock` (one watcher of a feature at a time), `intervalStamp` (run something at most once per interval), `folderEntries` (a folder's entries, none for a missing folder) |
| `src/skills/<sourceDirectory>/` | Authored skill payload copied verbatim into an installed skill directory (`SKILL.md`, `reference/`, `scripts/`, `templates/`) |
| `src/hooks/<sourceDirectory>/` | Feature-local dependency-free hook code compiled and installed to `.claude/agent-setup/hooks/`: `hooks/` (registered agent hooks), `watchers/` (background processes a hook starts), `command/` (scripts the CLI or a skill runs), `lib/` |
| `src/doctor/` | Structured installation health checks behind `agent-setup doctor` |
| `src/workflows/` | Copies the workflow templates into another repository (`agent-setup workflow scaffold`) |
| `src/scripts/` | Outer-ring tooling only: package build (`generateReadme`), style contract (`checkCodeStyle` + `reportCodeStyle`), rule-card format (`checkRuleCards` + `reportRuleCards`), never imported by product code |
| `src/templates/` | Files intentionally copied into another repository |
| `src/statuslines/` | Agent status-line presets installed by their own shell script (not receipt-owned) |
| `public/` | README image assets; referenced by absolute URL so npm renders them |
| `.husky/pre-commit` | Deterministic `pnpm verify` gate; never rewrites or stages files |

A feature is payload **or** hook code, never both. Put executable code under `src/hooks/`; put anything copied verbatim into a user's skill directory under `src/skills/`. `pnpm style` governs application, hook, and tooling code; skill payload answers to Biome and its own harness because it is authored for other repositories.

Golden paths: mirror `src/skills/githubRepoAbout/` for a copied skill, `src/hooks/duplicateCodeGuard/` for dependency-free policy/mechanism separation, and an existing file in `src/cli/` for a command adapter. Reuse the nearest capability seam; do not create a generic layer.

Names are plain English, one word per idea; the approved words live in [`LANGUAGE.md`](LANGUAGE.md).

<!-- rules digest — full guide in CODE-STYLE.md; edit there -->
## Working contract

Hard rules agents must hold every turn. Full prescription: [`CODE-STYLE.md`](CODE-STYLE.md).

- **Verify gate** — `pnpm verify` = Biome + typecheck + `style` + `style:guide` + tests + build + generated-document check. One root `tsconfig`; the image-to-code harness under `src/skills/imageToCode/scripts/` is the single sanctioned exception.
- **Effect / Schema** — capabilities return Effect; only `src/cli/main.ts` starts the runtime. Runtime, persisted, catalog, CLI, and agent-format data begin as Effect Schema. Application failures use `Schema.TaggedError`. No hand-rolled `isX` / `parseX` pairs for literals and numbers.
- **Hooks** — installed hooks stay dependency-free plain Node (`node:*`, `src/hooks/lib/**`, own feature code only), **fail-open**. Application code imports hook code only through a feature's `command/` module.
- **Ownership** — inspect → plan → validate → apply → write receipt last. A receipt is the only deletion authority. Catalog-closed shipping: the feature catalog owns exact shipped paths.
- **Shape** — capability-owned paths; camelCase authored directories; PascalCase UI files; kebab-case public IDs/flags. One command path; `TerminalUI` owns presentation; non-TTY never prompts.
- **Local tooling** — local `src/scripts/dev/` for personal/one-off scripts. All maintained build/verify tools live under `src/scripts/`, and product code never imports them.
- **Git hooks** — pre-commit runs `pnpm verify`; pre-push runs lint, typecheck, style and the README check (CI runs only test and build, on Linux); a new worktree needs `pnpm install` before its first push. Hooks report drift and never rewrite or stage files.
- **Branching** — never commit product work on `main`/default; use a topic branch (`feat/…`, `fix/…`, `refactor/…`, `chore/…`). Refinements to an existing feature still get their own branch.
- **Remote branches** — do not delete remote branches unless the user explicitly asks; leave them for handoff/CI after push or PR.
- **Parallel features** — one task per worktree under `.worktrees/`; issue + branch + PR to default with `Fixes #n` / `Closes #n`. Use `run-tasks-in-parallel` (setup-lanes / land-lanes).
- **Messy whole-repo cleanup** — backup default branch first, then one sub-agent per feature with PRs for human review (`clean-repo-by-feature`); ask host mode (background subagents vs cmux terminal per lane vs briefs only); never damage main history.
- **Unsure which skill** — run `which-skill` first: refine freeform → primary existing skill + pasteable prompt (do not invent a parallel workflow).
- **Ship** — verify gate green before push/PR; no force-push to protected branches; merge to default only when asked.

## Validate changes

Run the narrow suite for the changed capability, then the repository gate:

```bash
pnpm test
pnpm typecheck
pnpm verify
```

Both style commands are part of `pnpm verify`, so they gate:

```bash
pnpm style              # AST, path, and import-graph rules over the maintained tree
pnpm style:guide .      # rule-card format of CODE-STYLE.md; accepts any repo path
```

`pnpm style` gates application, tooling, payload placement, and `src/hooks/`; all are clean and must stay that way. Copied skill content follows Biome and its own harness rather than application architecture rules.

For image-to-code script changes:

```bash
pnpm --dir src/skills/imageToCode/scripts typecheck
```

## Issues

- Issues live on GitHub (`YosefHayim/agent-setup`); use the `gh` CLI.
- Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- Before changing image-to-code, read `src/skills/imageToCode/CONTEXT.md` and `TECH-GLOSSARY.md`.

## Local CI

Before opening a PR, run `.github/workflows/ci.yml` locally with the run-ci-locally skill. It runs one act process per job, each holding a machine-wide slot, so parallel sessions do not run Docker out of memory. Never run `act` on the whole workflow.
The machine's `~/.actrc` selects the Docker runner and the shared pnpm store, as the run-ci-locally skill describes. The repository has no `.actrc`, because act reads it last and it would override those machine settings.
