# LANGUAGE.md

## Terms

**owned file**
A file the installer manages, listed in the receipt's `ownedFiles` or marked by the `/agent-setup/` path.
_Avoid_: "managed" (without receipt context), "artifact".

**feature**
An installable unit with a public kebab-case ID, such as `scratch-folder-guard` or `image-to-code`.
_Avoid_: "plugin", "extension".

**sourceDirectory**
The camelCase folder that names a feature's code under `src/skills/` or `src/hooks/`, such as `scratchFolderGuard`; it is not the public ID.
_Avoid_: "skill folder name" (when used as the public ID).

**skill**
An agent instruction set under `src/skills/<sourceDirectory>/`; installed folder names stay kebab-case.
_Avoid_: "prompt", "instruction file".

**skill payload**
The authored content under `src/skills/` copied verbatim into an installed skill folder, including its `scripts/` and `templates/`.
_Avoid_: "payload" (alone), "skill code".

**hook code**
Dependency-free code under `src/hooks/<sourceDirectory>/` (folders `hooks/`, `watchers/`, `command/`, `lib/`), installed to `.claude/agent-setup/hooks/`.
_Avoid_: "skills".

**hook**
A zero-dependency script that runs on an agent hook event and must be **fail-open**.
_Avoid_: "callback", "handler".

**hook library**
The dependency-free code every hook feature shares under `src/hooks/lib/`, copied into each feature's `lib/` at install.
_Avoid_: "bundle", "binary".

**watcher**
A background Node process a hook starts to act later, such as the rehome, disk-cleanup and scratch watchers; it lives in its feature's `watchers/` folder.
_Avoid_: "service", "background job", "worker".

**decision**
A pure function that says what should happen next (`decideScratchWrite`, `decideRehome`), kept apart from the code that acts on it; its module is `<area>Decision.ts`.
_Avoid_: "policy engine", "rule engine".

**catalog**
The allowlist in `src/catalog/featureCatalog.ts` that declares every feature and what it ships.
_Avoid_: "registry", "`FEATURES`" (alone).

**receipt**
The ownership record at `.claude/agent-setup/receipt.json` that authorizes install, update and uninstall changes.
_Avoid_: "manifest".

**ships / shippedPaths**
The per-feature allowlist of paths copied into a user's install; unlisted paths ship nothing.
_Avoid_: "includes", "files".

**scope**
Where one installation lives: `global` (`~/.claude`) or `project` (`./.claude`), each with its own receipt and config.json.
_Avoid_: "target" (for the scope itself), "level".

**host**
The machine an install changes: its home and project roots, its agents and their files.
_Avoid_: "system".

**prepared package**
The catalog-closed copy of hook code and skill payload under `dist/prepared/` that install, update and doctor read.
_Avoid_: "build output".

**restoration**
A planned change that puts back a receipted file's bytes from before install: a rewrite, a removal, or a restored value inside a shared file.
_Avoid_: "rollback", "revert".

**doctor / health**
`doctor` is the read-only command; **health** is the report it returns for one scope (installation, config, features, agents, watchers, discrepancies).
_Avoid_: "diagnostics", "status check".

**setting**
One `config.json` key defined in `src/config/configSchema.ts`, named by its area word (`contextWarnPercent`); the CLI form is kebab-case (`context-warn-percent`).
_Avoid_: "option", "flag" (those are CLI arguments).

**environment variable**
An `AGENT_SETUP_<AREA>_<SETTING>` name listed in `src/config/environmentVariables.ts`, such as `AGENT_SETUP_REHOME_STATE_DIR`.
_Avoid_: "env key".

**native hook adapter**
Catalog evidence (`nativeHookAdapterSchema` in `src/catalog/agentCatalog.ts`) that an agent's lifecycle events, config path and compact command were verified.
_Avoid_: "supported" (without evidence).

**scratch-folder-guard**
Guard that denies agent writes into system temporary folders, asks the agent at turn end to delete its session's scratch files, and deletes an ended Claude Code session's scratch folder; code says "scratch" because "temp" and "tmp" are forbidden name tokens.
_Avoid_: "temp guard", "tmp hook".

**process-kill-guard**
Guard that denies a `pkill`, `killall` or pgrep-fed `kill` whose pattern would also match a running Claude Code session, its terminal, or an app the pattern does not name.
_Avoid_: "kill blocker", "pkill hook".

**leftover-process-cleanup**
Hook that, at turn end and when a subagent stops, stops servers whose working folder was deleted and orphaned test browsers older than an hour, and logs each one.
_Avoid_: "process reaper", "port cleaner".

**git-hook-guard**
Guard that denies a git command that skips git hooks, and a `git commit` or `git push` in a worktree whose hooks are not installed yet.
_Avoid_: "no-verify blocker", "husky check".

**session-rehome**
Feature that moves an ended Claude Code session or Codex thread into the local repo its work was about, so that repo's resume lists it; "rehome" is the verb for that move.
_Avoid_: "migrate", "relocate".

**sweep**
session-rehome's pass over every ended session not yet settled in the ledger; the SessionStart hook starts one at most every ten minutes.
_Avoid_: "scan", "crawl".

**ledger**
session-rehome's append-only record of every decision (moved, stayed, uncertain, no-signal, deleted, conflict); the newest line for a session wins.
_Avoid_: "log", "history".

**disk-cleanup**
Feature that, when a session ends, pushes and removes finished git worktrees under the code folders that no open session uses, and pushes unpushed branches; branches always stay.
_Avoid_: "garbage collection".

**cache cleanup**
disk-cleanup's daily pass that deletes build folders, old Codex versions and tool caches nothing has used for two weeks, and runs each tool's own prune.
_Avoid_: "purge".

**image-to-code**
A skill that turns an image (PNG, screenshot, design) into measured pixel-perfect code (SVG, HTML, CSS), checked with a screenshot-diff harness.

**workflow scaffold**
CLI command that copies the owned single-gate CI and publish set into another repository.
_Avoid_: "ci-setup".

**fail-open**
Hooks must exit successfully on any error so a guard bug never blocks the user.
_Avoid_: "graceful degrade".

**biome**
Linter and formatter; `biome ci` is the lint half of the gate.
_Avoid_: "linter", "prettier".

**co-located tests**
`foo.test.ts` beside `foo.ts`; a test of one aspect of a module is `foo.<aspect>.test.ts`.
_Avoid_: "test/ dir".

**SSOT**
Single source of truth: `src/config/configSchema.ts` holds the managed-configuration contract, `src/config/environmentVariables.ts` every environment variable, and `src/hooks/lib/hookConfig.ts` the hook projection.
_Avoid_: "source of truth".

**agent-voice / free-model-router**
Separate apps that own voice and free provider routing; agent-setup does not ship, call or configure them.

**check**
The one aggregate script (`pnpm check`) that owns every repository check required by CI.
_Avoid_: "qa", "validate".

## Swaps

| Avoid | Use |
| --- | --- |
| managed (without receipt context) | owned file |
| artifact | owned file |
| plugin | feature |
| extension | feature |
| skill folder name (as the public ID) | feature |
| prompt | skill |
| instruction file | skill |
| skill code | skill payload |
| payload (alone) | skill payload |
| skills (for hook code) | hook code |
| callback | hook |
| handler | hook |
| bundle (for hook library) | hook library |
| binary | hook library |
| service | watcher |
| background job | watcher |
| worker | watcher |
| policy engine | decision |
| rule engine | decision |
| registry | catalog |
| `FEATURES` | catalog |
| manifest | receipt |
| includes | ships / shippedPaths |
| files | ships / shippedPaths |
| target (for the scope itself) | scope |
| level | scope |
| system | host |
| build output | prepared package |
| rollback | restoration |
| revert | restoration |
| diagnostics | doctor / health |
| status check | doctor / health |
| option | setting |
| flag | setting |
| env key | environment variable |
| supported (without evidence) | native hook adapter |
| temp guard | scratch-folder-guard |
| tmp hook | scratch-folder-guard |
| kill blocker | process-kill-guard |
| pkill hook | process-kill-guard |
| process reaper | leftover-process-cleanup |
| port cleaner | leftover-process-cleanup |
| no-verify blocker | git-hook-guard |
| husky check | git-hook-guard |
| migrate | session-rehome |
| relocate | session-rehome |
| scan | sweep |
| crawl | sweep |
| log | ledger |
| history | ledger |
| garbage collection | disk-cleanup |
| purge | cache cleanup |
| ci-setup | workflow scaffold |
| graceful degrade | fail-open |
| linter | biome |
| prettier | biome |
| test/ dir | co-located tests |
| source of truth | SSOT |
| qa | check |
| validate | check |
