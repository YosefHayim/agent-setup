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
| `src/skills/<sourceDirectory>/` | Authored skill payload, shipped verbatim |
| `src/hooks/<sourceDirectory>/` | Feature-local executable hook code |
| [`README.md` → Settings](README.md#settings) | Every setting and environment variable (generated) |

Public feature and installed-skill IDs are decoded catalog data and can differ from the authored camelCase directory name.

Golden paths: mirror `src/skills/githubRepoAbout/` for a copied skill, `src/hooks/duplicateCodeGuard/` for dependency-free policy/mechanism separation, and an existing file in `src/cli/` for a command adapter. Reuse the nearest capability seam; do not create a generic layer.

Names are plain English, one word per idea; the approved words live in [`LANGUAGE.md`](LANGUAGE.md).

## Working contract

Hard rules agents must hold every turn.

- **Verify gate** — `pnpm verify` = Biome + knip + typecheck + tests + build + generated-document check. One root `tsconfig`; the image-to-code harness under `src/skills/imageToCode/scripts/` is the single sanctioned exception.
- **Effect / Schema** — capabilities return Effect; only `src/cli/main.ts` starts the runtime. Runtime, persisted, catalog, CLI, and agent-format data begin as Effect Schema. Application failures use `Schema.TaggedError`. No hand-rolled `isX` / `parseX` pairs for literals and numbers.
- **Hooks** — installed hooks stay dependency-free plain Node (`node:*`, `src/hooks/lib/**`, own feature code only), **fail-open**. Application code imports hook code only through a feature's `command/` module.
- **Ownership** — inspect → plan → validate → apply → write receipt last. A receipt is the only deletion authority. Catalog-closed shipping: the feature catalog owns exact shipped paths.
- **Shape** — capability-owned paths; camelCase authored directories; PascalCase UI files; kebab-case public IDs/flags. One command path; `TerminalUI` owns presentation; non-TTY never prompts.
- **Local tooling** — local `src/scripts/dev/` for personal/one-off scripts. All maintained build/verify tools live under `src/scripts/`, and product code never imports them.
- **Git hooks** — pre-commit runs `pnpm verify`; pre-push runs lint (Biome and knip), typecheck and the README check (CI runs only test and build, on Linux); a new worktree needs `pnpm install` before its first push. Hooks report drift and never rewrite or stage files.
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
