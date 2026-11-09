# CONTEXT.md — agent-setup

Orientation: what this is, its moving parts, and how they fit. For the words, see
`LANGUAGE.md`; for purpose and direction, `PROJECT.md`; for how to work in the repo, `AGENTS.md`.

## What this is

`agent-setup` is a personal toolbelt, not a platform: a TypeScript/Node CLI that installs, updates, and surgically uninstalls a curated set of coding-agent guardrails, skills, and copyable CI/publish workflow templates. Installed TypeScript hooks are separate dependency-free Node code. Voice (dictation, read-aloud, prompt refinement) is a separate app, agent-voice, and free provider routing is another, free-model-router.

## Actors

- **The owner / user** — runs `pnpm tsx src/cli/main.ts install` to wire guardrails into `~/.claude` (global) or `./.claude` (project).
- **Claude Code, Codex, and Grok** — verified native lifecycle-hook targets.
- **Other agents** — detected and wired only through verified catalog-driven formats; unsupported hook adapters are reported, not guessed.
- **CI / `workflow scaffold` consumers** — repositories that copy the single-gate CI/publish set from `src/templates/workflows/`.

## Shape (capability layout)

Application code is grouped by capability, not by technical layer:

- `src/cli/` — Effect CLI edge (`main`, one file per command, `TerminalUI`)
- `src/catalog/` — feature and agent catalogs (decoded data is the SSOT)
- `src/config/` — managed configuration schema (`configSchema`), config.json bytes and install plan (`configFile`), one scope's config read and save (`scopeConfig`), host scan (`hostScan`), and the list of every environment variable
- `src/install/` — install plans, package preparation, receipts, transactional apply, lifecycle
- `src/hooks/lib/` — dependency-free code shared by every hook feature: `hookConfig` (config.json and install root), `hookOutput` (hook decisions on stdout), `bashHookInput` (the shell command and start folder of a Bash tool call), `shellSegments` (a shell command split into its simple commands), `processAlive` (is a pid running), `transcriptReader` (agent transcript lines), `claudeLiveSessions` (which Claude Code sessions are running), `claudeJobs` (the state of each Claude Code background job), `claudeScratchRoots` (where Claude Code keeps session scratch folders), `codexHome` (where Codex keeps its files), `jsonLines` (JSON-lines files), `sessionIds` (session ids from hook input), `sessionEvidence` (the folders and repos a transcript worked in), `pathMatcher` (which named folders a text mentions), `patternEscape` (text as a literal regex), `codeRepos` (git repos under the code folders), `gitAnswers` (git calls and their output lines), `detachedWatcher` (start a watcher that outlives its hook), `watcherLock` (one watcher of a feature at a time), `intervalStamp` (run something at most once per interval), `folderEntries` (a folder's entries, none for a missing folder)
- `src/skills/<sourceDirectory>/` — authored skill payload only (kebab-case directories), shipped verbatim
- `src/hooks/<sourceDirectory>/` — feature-local executable hook code: `hooks/` (registered agent hooks), `watchers/` (background processes a hook starts), `command/` (scripts the CLI or a skill runs), `lib/`
- `src/doctor/` — installation health checks behind `agent-setup doctor`
- `src/workflows/` — workflow template copying behind `agent-setup workflow scaffold`
- `src/scripts/` — outer-ring maintainer tooling (build, README generation); never imported by product code
- `src/templates/` — copyable workflows and project docs
- `src/statuslines/` — agent status-line presets with their own install script
- `dist/prepared/` — catalog-closed prepared package for install/update/doctor

The repository root holds only configuration and top-level docs; everything authored lives under `src/`.

A feature is either payload or hook code, never both: `src/skills/` holds only what is copied verbatim into an installed skill directory, and `src/hooks/` holds only code this repository compiles and installs elsewhere. The split is what lets the style contract apply one rule set per kind of code.

## Key constraints

- Hooks must be **fail-open** — any internal error allows the tool through.
- Ownership is receipt-based: install/update/uninstall change only files the receipt owns.
- Managed config lives at `.claude/agent-setup/config.json` and is schema-owned. Installed hooks read that same file.
- Hook state lives under `.claude/agent-setup/state/` (`session-rehome/`, `disk-cleanup/`); the Claude Code status line caches under `state/statusline/`.
- Hook background processes are **watchers** (the rehome watcher, the disk-cleanup watcher, the scratch watcher) and live in a feature's `watchers/` folder.
- Every setting and environment variable is listed in the Settings section of `README.md`, generated from `src/config/config-schema.ts` and `src/config/environment-variables.ts`. Environment variables are named `AGENT_SETUP_<AREA>_<SETTING>`, config keys start with their area word (`session-rehome`, `disk-cleanup`, `debug`), and a test fails when an `AGENT_SETUP_*` name in `src/` is missing from the list.
- Authored skill directories use **kebab-case**, like public feature IDs and installed skill IDs.
- One strict style bar across maintained TypeScript, enforced by the personal rules in `~/.claude/rules/`. Biome and knip gate through `pnpm check`, including `src/hooks/`; portable skill scripts additionally answer to their shipped harnesses.
- Root `AGENTS.md` is the authoritative contract for coding agents and routes each subject to its delegated SSOT.
