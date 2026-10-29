# LANGUAGE.md — agent-setup

The human↔agent glossary: names only. Use these exact terms in code, comments,
commits, and docs; avoid the listed aliases. Orientation lives in `CONTEXT.md`.

Names are plain English, one word per idea. A file is named after what is inside it,
and a command file is named after its command.

## Terms

**owned file**
A file the installer manages, recorded in the receipt's `ownedFiles` list or marked by the `/agent-setup/` path.
_Avoid_: "managed" (without receipt context), "artifact".

**feature**
An installable unit such as `context-guard`, `duplicate-code-guard`, `autorun`, or `image-to-code` (public kebab-case IDs).
_Avoid_: "plugin", "extension".

**sourceDirectory**
Authored camelCase directory naming a feature under `src/skills/` (payload) or `src/hooks/` (hook code) — e.g. `contextGuard`, `duplicateCodeGuard`, `imageToCode`. Distinct from the public feature ID.
_Avoid_: "skill folder name" when used as public ID.

**skill**
Agent instruction set under `src/skills/<sourceDirectory>/`. Installed directory names stay kebab-case data.
_Avoid_: "prompt", "instruction file".

**skill payload**
Approved compound for authored content under `src/skills/` copied verbatim into an installed skill directory, including its `scripts/` and `templates/`.
_Avoid_: standalone "payload", "skill code".

**hook code**
Executable dependency-free code under `src/hooks/<sourceDirectory>/` plus the shared `src/hooks/lib/`. Compiled and installed to `.claude/agent-setup/hooks/`. A feature's folders: `hooks/` holds registered agent hooks, `watchers/` the background processes a hook starts, `command/` scripts the CLI or a skill runs, and `lib/` its own code.
_Avoid_: "skills", "payload".

**hook**
Zero-dependency script that runs on an agent hook event. Must be **fail-open**.
_Avoid_: "callback", "handler" (imprecise).

**hook library**
Dependency-free code every hook feature shares under `src/hooks/lib/` (`hookConfig`, `hookOutput`, `processAlive`, `transcriptReader`, `claudeLiveSessions`, `claudeScratchRoots`), copied into each hook feature's `lib/` at install.
_Avoid_: "payload", "bundle", "binary".

**watcher**
Background Node process a hook starts so it can act later: the autorun watcher, the idle compact watcher, the rehome watcher, and the scratch watcher. It lives in its feature's `watchers/` folder.
_Avoid_: "service", "background job", "worker".

**decision**
Pure function that says what should happen next (`decideAutorunStep`, `decideIdleCompactAction`, `decideDuplicateEdit`, `decideScratchWrite`, `decideRehome`), kept apart from the code that acts on it. Its module is named `<area>Decision.ts`.
_Avoid_: "policy engine", "rule engine".

**catalog**
The allowlist in `src/catalog/featureCatalog.ts` that declares every feature and what it ships.
_Avoid_: "registry", "manifest", "`FEATURES`" alone.

**receipt**
Ownership record at `.claude/agent-setup/receipt.json` authorizing install/update/uninstall changes.
_Avoid_: "manifest".

**ships / shippedPaths**
Per-feature allowlist of paths copied into a user's install. Fail-safe: unlisted paths ship nothing.
_Avoid_: "includes", "files".

**scope**
Where one installation lives: `global` (the home root, `~/.claude`) or `project` (a project root, `./.claude`). Each scope has its own receipt and config.json.
_Avoid_: "target" for the scope itself, "level".

**host**
The machine an install changes, as opposed to the package: its home and project roots, its agents, and their files. `hostScan` reads it; `hostFiles` snapshots its files.
_Avoid_: "system", "environment" (that word is for environment variables).

**prepared package**
The catalog-closed copy of hook code and skill payload under `dist/prepared/` that install, update, and doctor read.
_Avoid_: "bundle", "build output".

**restoration**
A planned change that puts back a receipted file's bytes from before install: a rewrite, a removal, or a restored value inside a shared file.
_Avoid_: "rollback", "revert".

**doctor / health**
`doctor` is the read-only command; the **health** report is what it returns for one scope (installation, config, features, agents, watchers, discrepancies).
_Avoid_: "diagnostics", "status check".

**surgical install / uninstall**
Receipt-authorized edits that restore prior bytes on uninstall.
_Avoid_: "merge", "patch".

**setting**
One `config.json` key defined in `src/config/configSchema.ts`. The key starts with its area word (`contextWarnPercent`); the CLI name is its kebab-case form (`context-warn-percent`).
_Avoid_: "option", "flag" (those are CLI arguments).

**environment variable**
A `AGENT_SETUP_<AREA>_<SETTING>` name listed in `src/config/environmentVariables.ts`, for example `AGENT_SETUP_IDLE_COMPACT_AFTER`.
_Avoid_: "env key".

**context-guard**
Nudge `/handoff` at the warn percent and hard-deny new code edits at the block percent.
_Avoid_: "context manager".

**idle compact**
Optional native-hook loop that submits one idle draft, waits for any resulting turn, compacts once, then parks.
_Avoid_: "autorun" (different context-budget loop), "timer wrapper".

**native hook adapter**
Catalog evidence that an agent's lifecycle events, config path, and compact command were verified.
_Avoid_: "supported" without evidence.

**terminal claim**
Session-start proof binding automation to one stable Ghostty terminal ID, including tabs and splits.
_Avoid_: "focused pane", "front window".

**duplicate-code-guard**
Guard that blocks a copied function body or type shape at write time. `agent-setup duplicates` runs the same check from the CLI or CI.
_Avoid_: "duplicate checker".

**scratch-folder-guard**
Guard that denies agent writes into system temporary folders, asks the agent at the end of a turn to delete the files its session left in its scratch folder, and deletes an ended Claude Code session's own scratch folder. Code names say "scratch" because `temp`/`tmp` are forbidden name tokens.
_Avoid_: "temp guard", "tmp hook".

**process-kill-guard**
Guard that denies a `pkill`, `killall`, or pgrep-fed `kill` whose pattern also matches a running Claude Code session, the terminal and shells it runs in, or an app the pattern does not name.
_Avoid_: "kill blocker", "pkill hook".

**git-hook-guard**
Guard that denies a git command that skips or disables git hooks, and a `git commit` or `git push` in a worktree whose hooks are not installed yet.
_Avoid_: "no-verify blocker", "husky check".

**session-rehome**
Feature that moves an ended Claude Code session or Codex thread into the local repo its work was about, so that repo's `/resume` or `codex resume` lists it. "Rehome" is the verb for that move; a session's **home** is the folder its agent lists it under.
_Avoid_: "migrate", "relocate" (Claude Code's own word for its worktree moves).

**sweep**
session-rehome's pass over every ended session that is not yet settled in the ledger. The SessionStart hook starts one at most every ten minutes; `rehomeWatcher --sweep` runs one by hand.
_Avoid_: "scan", "crawl".

**ledger**
session-rehome's append-only record of every decision (moved, stayed, uncertain, no-signal, deleted, conflict); the newest line for a session wins.
_Avoid_: "log", "history" (Claude Code's `history.jsonl` is a different file).

**disk-cleanup**
Feature that, when a session ends, pushes and removes the finished git worktrees under the code folders that no open session uses, pushes the unpushed branches, including ones checked out in worktrees it keeps or never looks at, and once a day runs the **cache cleanup**. Branches always stay, and a worktree or branch it cannot push safely stays too, until a later session's end looks at it again.
_Avoid_: "garbage collection", "sweep" (session-rehome's word).

**cache cleanup**
disk-cleanup's daily pass over build folders, old Codex versions, and tool caches: it deletes the ones nothing has used for two weeks and runs each tool's own prune.
_Avoid_: "sweep", "purge".

**autorun**
Feature and skill that arms the context-guard autorun watcher for hands-free compact/resume (`stop`/`exit` verbs). Its hook code is owned by **context-guard**.
_Avoid_: "auto-compact", "autopilot".

**image-to-code**
Image (PNG, screenshot, design) → measured pixel-perfect code skill (SVG/HTML/CSS) with screenshot-diff harness.

**workflow scaffold**
CLI command that copies the owned single-gate CI/publish set into another repository.
_Avoid_: "ci-setup".

**fail-open**
Hooks must exit successfully on any error so a guard bug never blocks the user.
_Avoid_: "graceful degrade".

**capability layout**
Folders group by product capability (`cli`, `catalog`, `config`, `install`, `hooks`, `skills`, `doctor`, `workflows`), plus the outer-ring `scripts`, the copied `templates`, and the `statuslines` presets.
_Avoid_: "src/core layers", pure-core/imperative-shell folders.

**biome**
Linter and formatter; `biome ci` is the lint half of the gate.
_Avoid_: "linter", "prettier" (only half).

**co-located tests**
`foo.test.ts` beside `foo.ts`; a test of one aspect of a module is `foo.<aspect>.test.ts` (`featureCatalog.skillPayload.test.ts`).
_Avoid_: "test/ dir".

**vertical per feature**
Each feature owns one folder named for its `sourceDirectory` — under `src/skills/` when it ships payload, under `src/hooks/` when it ships hook code.
_Avoid_: "horizontal layers".

**single command per tool surface**
One `autorun` skill with verbs instead of multiple thin skills.
_Avoid_: "one skill per verb".

**agent root contract**
Root `AGENTS.md`, authoritative for agent behavior and the routing map to delegated subject SSOTs.
_Avoid_: "agent digest" when implying it is non-authoritative.

**SSOT**
Single source of truth; the full managed-configuration contract lives in `src/config/configSchema.ts`, every environment variable in `src/config/environmentVariables.ts`, while `src/hooks/lib/hookConfig.ts` holds only the dependency-free hook projection.
_Avoid_: "source of truth" (acceptable, but the acronym is established).

**agent-voice / free-model-router**
Separate apps that own voice and free provider routing. agent-setup does not ship, call, or configure them.
_Avoid_: describing their internals here.

**clean break**
No back-compat shims on renames/pivots. Old installs upgrade by uninstalling with the old version, then installing the new one.
_Avoid_: "migration", "deprecation".

**check**
The one aggregate script (`pnpm check`) that owns every repository check required by CI.
_Avoid_: "qa", "validate".
