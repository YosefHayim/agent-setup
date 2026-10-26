# agent-setup

<p align="center">
  <img src="https://raw.githubusercontent.com/YosefHayim/agent-setup/main/public/hero.png" alt="agent-setup - install owned agent skills, hooks, and templates into Claude Code projects" width="640" />
</p>

`agent-setup` is a one-command installer for Yosef's reusable [Claude Code](https://code.claude.com/docs/en/overview) skills, hooks, and repo templates. It is a [TypeScript](https://www.typescriptlang.org/) CLI for [Node.js](https://nodejs.org/en), built with [pnpm](https://pnpm.io/), [Biome](https://biomejs.dev/), and [Vitest](https://vitest.dev/).

It installs into global `~/.claude` or project-local `.claude/`, keeps Schema-validated managed configuration, edits agent settings surgically, and removes only the files its receipt owns. The shipped skills target Claude Code first, while the docs and some skills also account for [Cursor](https://cursor.com/docs), [OpenAI Codex](https://developers.openai.com/codex), [Kiro](https://kiro.dev/docs/steering/), [Gemini CLI](https://geminicli.com/docs/cli/gemini-md/), and [Roo Code](https://docs.roocode.com/features/custom-instructions/).

## Quick start

Install the safe default scratch folder guard globally:

```bash
npx agent-setup install
```

Then restart Claude Code so hooks and skills load in the next session.

For a repo-local install that can be committed with the project:

```bash
npx agent-setup install --scope project
```

## Usage

Print command help, or open the interactive TUI (same options as CLI args; shows an ordered plan and asks for approval before applying):

```bash
npx agent-setup
npx agent-setup menu
```

Add a specific skill or hook set. `install` only adds: features that are already installed stay installed:

```bash
npx agent-setup install write-readme update-agent-docs
npx agent-setup install duplicate-code-guard
npx agent-setup install image-to-code
```

Keep an existing install and refresh its copied skills and hooks. Named IDs must already be installed; every installed feature is refreshed and none is removed:

```bash
agent-setup update
agent-setup update context-guard
```

To drop some features, open `agent-setup menu`, pick Update, then Choose features: it starts from the installed set, and the features you untick are removed.

Remove only the hooks, skill files, and settings entries the receipt owns:

```bash
agent-setup uninstall
agent-setup uninstall --scope project
```

Inspect host support and installed state without changing files:

```bash
agent-setup doctor
```

Inspect or change the managed configuration one setting at a time:

```bash
agent-setup config show
agent-setup config set context-warn-percent 15
agent-setup config set context-block-percent 22
agent-setup config set idle-compact-after 1m
```

Every setting and `AGENT_SETUP_*` environment variable is listed under [Settings](#settings).

Scaffold the copyable workflow set or scan a workspace for duplicates:

```bash
agent-setup workflow scaffold .
agent-setup duplicates . --staged
```

### Idle compact

Idle compact is off by default (`idle-compact-after off`). On macOS with Ghostty 1.3+, verified native
hooks for Claude Code, Codex, and Grok bind each session to its exact terminal.
Override one launched agent without changing persistent config, for example
`AGENT_SETUP_IDLE_COMPACT_AFTER=30s codex` or `AGENT_SETUP_IDLE_COMPACT_AFTER=off grok`.

### Status lines

Status-line presets for Claude Code and Codex live in `src/statuslines/`. Each installs with its own script from a clone of this repository, outside the receipt (see [Claude Code](src/statuslines/claude/README.md) and [Codex](src/statuslines/codex/README.md)):

```bash
./src/statuslines/claude/install.sh
./src/statuslines/codex/install.sh
```

## What it installs

`scratch-folder-guard`, `process-kill-guard`, and `git-hook-guard` are the safe defaults. `process-kill-guard` blocks a `pkill` or `killall` whose pattern would also stop a running Claude Code session, the terminal it runs in, or an app the pattern does not name. `git-hook-guard` blocks `--no-verify`, `git commit -n`, `HUSKY=0`, and `core.hooksPath` overrides, and a commit or push from a worktree whose hooks are not installed yet. `scratch-folder-guard` keeps agents from writing into `/tmp`, `/private/tmp`, or the macOS temporary folder, asks the agent at the end of a turn to delete the files its session left in its scratch folder, and clears each ended Claude Code session's scratch folder unless its subagents were still running. The other hooks are opt-in. `context-guard` warns and then blocks edits as a session nears its context cap, and can compact idle sessions. `duplicate-code-guard` blocks duplicate TypeScript functions and type shapes at write time where the agent platform supports it. `session-rehome` moves each ended session into the repo it was about. `disk-cleanup` pushes and removes the finished worktrees a session made or worked in when it ends, pushes the unpushed branches of the repos it named, and once a day clears stale build folders and caches. `autorun` is a macOS-specific convenience driven in-session by `/autorun`. The remaining entries are pure skills with no hooks — no configuration needed, just ask your agent to do the thing (e.g. "convert this PNG to code"). Skills authored by others are bundled too, but credited separately under [Recommended community skills](#recommended-community-skills).

<!-- AUTO:FEATURES:START -->
| Feature | What it does | Runs on |
| --- | --- | --- |
| **context-guard** | Guard long sessions near their context cap and optionally compact idle Claude Code, Codex, or Grok sessions in their exact Ghostty terminal. | 🟢 any OS |
| **autorun** | Let the agent keep working alone. When the context is almost full and a fresh handoff note exists, it runs /compact and continues the task. macOS + Ghostty only (it types into your terminal). The hook code lives in context-guard. | 🔴 macOS + Ghostty |
| **duplicate-code-guard** | Block a Write/Edit that pastes a function body or interface/type shape already defined elsewhere in the repo — DRY enforced at the moment of the write. Uses the repo's own TypeScript; blocks by default (tune with `agent-setup config set duplicate-code-mode warn`). Agents without edit hooks can run `agent-setup duplicates` as a pre-commit or CI check. | 🟢 any OS |
| **scratch-folder-guard** | Block every agent write into system temporary folders (/tmp, /private/tmp, /var/tmp, /dev/shm, $TMPDIR) — files, edits, shell redirects, copies, and mktemp — so logs and scratch files stay in a gitignored repo folder. When a turn ends with files left in the session's scratch folder, asks the agent to delete them once the user's tasks are finished, and deletes each ended Claude Code session's own scratch folder unless its subagents were still running. | 🟢 any OS |
| **process-kill-guard** | Block pkill, killall, and pgrep-fed kill commands whose pattern would also stop a running Claude Code session, the terminal and shells it runs in, or an app in /Applications the pattern does not name — e.g. `pkill -f cat` matches every "/Applications" path and every session whose settings mention "notifications". The agent is told to kill only the pids it started. | 🟢 any OS |
| **git-hook-guard** | Block git commands that skip or disable git hooks (`--no-verify`, `git commit -n`, `HUSKY=0`, `core.hooksPath` overrides), and commits and pushes in a worktree whose hooks are not installed yet, e.g. a fresh worktree before `pnpm install`. The agent is told to fix what the hooks report instead. | 🟢 any OS |
| **session-rehome** | Move each ended Claude Code session and Codex thread into the repo it was about, so `/resume` and `codex resume` in that repo list it. Sessions started in ~/Desktop/Code, ~, /tmp, or a deleted worktree move when one repo clearly dominates their work; resuming a moved session from its old folder says where it went. | 🟢 any OS |
| **disk-cleanup** | When a Claude Code or Codex session ends, push and remove the finished git worktrees under your code folders that the session made or worked in: leftover changes are committed and every branch is kept. Worktrees another open session uses, made in the last hour, on the default branch, with secret or very large files, or whose push fails stay, and later session ends look at them again. Unpushed branches no worktree holds, in the repos the session named, are pushed to a branch of the same name, with the same limits. Once a day it also deletes Xcode build folders of gone projects, old Codex versions, and npx and act caches unused for two weeks, and runs the simulator, pnpm, and uv prunes. What each pass did, other than a dry run, is added to state/disk-cleanup/cleanup.log. | 🟢 any OS |
| **image-to-code** | Turn an image (PNG, screenshot, design) into code that looks the same — SVG, HTML/CSS, or animation — checked with pixel diffs. | 🟢 any OS |
| **github-repo-about** | Write the GitHub "About" box — a one-line description, a website link, and topics. | 🟢 any OS |
| **write-blog-post** | Write a new portfolio blog post in the owner's voice, add it to the blog data file, and make a matching cover image in ChatGPT. | 🟢 any OS |
| **write-readme** | Write or fix the README and other start-here docs. Reads the repo first, then asks you questions one by one. | 🟢 any OS |
| **update-agent-docs** | Create or update agent instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, Cursor rules, and more) based on each agent's official docs. | 🟢 any OS |
| **simplify-code** | Remove extra code — wrappers, layers, folders, generic names, and scripts the job does not need. | 🟢 any OS |
| **code-style** | Ask you questions about code style, folder structure, and CLI, reading the real code when there is some, then write CODE-STYLE.md, a formatter config, and the project docs. Can also only check code against the rules. | 🟢 any OS |
| **code-style-teach-me** | While you build, stop at each real choice, show two options, and explain the rule so you learn your own architecture. | 🟢 any OS |
| **code-style-review** | Check a big change (branch or PR) against the style rules and get a short report, so you do not need to read every file. | 🟢 any OS |
| **explain-my-stack** | Understand why the project uses each technology (language, framework, services), with honest trade-offs and a plain glossary, all in chat. | 🟢 any OS |
| **plan-page** | Show a plan, approval step, or report as an interactive HTML page (open-source planpage package) where you can approve or change choices. | 🟢 any OS |
| **website-speed-ci** | Add website speed checks (Lighthouse CI, Core Web Vitals, CrUX) to CI so a slow change fails the PR. | 🟢 any OS |
| **chrome-store-seo** | Improve your Chrome Web Store text (name, summary, description) and landing page so more people find the extension. | 🟢 any OS |
| **make-promo-video** | Make a short promo video for a project — story, images, animation, voice, music, and a cut for each social app. | 🟡 macOS |
| **check-website-quality** | Scan a website for HTML structure, accessibility, images, speed, security headers, SEO, and AI-readiness, then fix what is wrong. | 🟢 any OS |
| **organize-commits** | Split your changes into small, clear commits with good messages, and clean up history and branches. | 🟢 any OS |
| **finish-and-push** | Finish the work — run checks, commit, push to a feature branch, and clean up leftovers. | 🟢 any OS |
| **run-local-and-check** | Run the app on your computer and prove it works in a real browser or app. No deploy. | 🟢 any OS |
| **run-ci-locally** | Run the repo's GitHub Actions workflows in Docker with act when Actions cannot run, then remove everything the run made. | 🟢 any OS |
| **reuse-before-build** | Before building a feature, find code, packages, or platform features you already have that can do the job. | 🟢 any OS |
| **find-repeated-prompts** | Read your past agent sessions and find prompts and work patterns you repeat, as ideas for new skills. | 🟢 any OS |
| **install-skills** | Install or update skills in all your coding agents and check that each agent can really find them. | 🟢 any OS |
| **fix-env-config** | Put env variables and config in one place with types and checks, and find duplicates, silent defaults, and secrets leaking to the client. | 🟢 any OS |
| **add-mcp-server** | Add an MCP server to your agents, log in with OAuth, and check that its tools really work. | 🟢 any OS |
| **check-rtl-ui** | Check and fix right-to-left screens (Hebrew, Arabic, Persian, Urdu) — layout, mixed-direction text, icons, forms, and accessibility. | 🟢 any OS |
| **deploy-and-check** | Deploy to production and prove it is really live with checks against the real URL. | 🟢 any OS |
| **fix-bug** | Reproduce the bug first, find the real cause, fix it, and prove the fix works. | 🟢 any OS |
| **run-tasks-in-parallel** | Give a numbered task list, and each task gets its own agent, branch, tests, and PR. | 🟢 any OS |
| **ship-one-feature** | Take one feature or one GitHub issue all the way — branch, code, tests, PR, merge, and reinstall. | 🟢 any OS |
| **find-missing-tests** | Find the tests each feature is missing (unit, mocks, integration, e2e), then write them test-first. | 🟢 any OS |
| **ship-missing-tests** | Find missing tests in many features, fill them in parallel branches, and merge to main after checks. | 🟢 any OS |
| **simplify-repo-with-tests** | Find over-engineering across the repo, simplify it, and use tests to prove the behavior did not change. | 🟢 any OS |
| **restructure-repo** | Clean a whole repo — folders, names, code, and deps — against its own docs and the official docs of every framework it uses, one approved phase at a time on a branch. | 🟢 any OS |
| **improve-ux** | Make user flows easier (fewer clicks, better layout, forms, mobile). Shows before/after designs first, then builds the one you pick. | 🟢 any OS |
| **design-app-mockup** | Turn an app idea into premium, Framer-level UI mockups: pick one of 3 real templates, get a hi-fi landing page inspired by it, or a close match in your own colors and content, then a UI library from that page, custom icons, real photos, and clickable app journeys. | 🟢 any OS |
| **free-ports** | Stop local servers that block ports (keeps Metro on 8081) so you can start dev again. | 🟢 any OS |
| **clone-all-repos** | Clone or update all your GitHub repos into your Code folder and report what changed. | 🟢 any OS |
| **manage-cloudflare** | Set up and fix Cloudflare — wrangler config, D1, KV, R2, Workers and Pages projects, and secrets. | 🟢 any OS |
| **clean-repo-by-feature** | Back up main, then clean a messy project with one agent and one branch per feature, and open one PR per feature for you to review. | 🟢 any OS |
| **add-skill** | Describe a new skill and answer its questions; it shows the whole skill for approval, then adds, checks, and installs it. | 🟢 any OS |
| **improve-skill** | Change an existing skill based on feedback or on what went wrong in a real session. | 🟢 any OS |
| **which-skill** | Not sure which skill to use? It turns your request into a short plan with the right skills and a ready prompt. | 🟢 any OS |
| **benchmark-agents** | Run the same tasks with different agents, skills, or tools and compare tokens, time, cost, and success. | 🟢 any OS |
| **release-mobile-app** | Build and upload the app to App Store, TestFlight, or Google Play, and prove which commit, version, and build was sent. | 🟢 any OS |
| **save-as-skill** | Turn what we just did into something you can reuse — a skill, script, template, test, or runbook. | 🟢 any OS |
| **finish-old-sessions** | Find unfinished work in past agent sessions, compare it with the repos, and finish each task or mark it honestly. | 🟢 any OS |
<!-- AUTO:FEATURES:END -->

## Recommended community skills

<!-- AUTO:SKILLS:START -->
These skills ship with agent-setup for convenience — installable the same way (`npx agent-setup install <id>`) — but they are **authored by others**, not by agent-setup. Full credit and upstream sources:

| Skill | What it does | By |
| --- | --- | --- |
| **make-code-readable** | Use when you want code that is easier to read — clearer names, order, files, and functions. It shows before and after, and changes code only after you approve. Say "make this readable", "rename for clarity", or "clean this up". To remove extra layers, use simplify-code. For a whole repo, use restructure-repo. | [Mike Cann](https://github.com/mikecann/agent-skills) (upstream: `deslop`) |
| **question-my-plan** | Use when you want the agent to ask you hard questions about your plan until you both understand it the same way. When the repo has PROJECT.md, CONTEXT.md, or LANGUAGE.md, or you ask for it, it also checks the plan against them and updates them as you decide. Say "grill me", "question my plan", or "grill me with docs". | [Matt Pocock](https://github.com/mattpocock/skills) (upstream: `grill-me`, `grill-with-docs`) |

> `code-style` is an agent-setup-original skill that builds on Matt Pocock's grilling pattern — it stays in the owned catalog above.
<!-- AUTO:SKILLS:END -->

## Settings

<!-- AUTO:SETTINGS:START -->
agent-setup keeps one `config.json` in its install root: `~/.claude/agent-setup/config.json` for a global install, `.claude/agent-setup/config.json` for a project install. Change a setting with `agent-setup config set <setting> <value>`, show it with `agent-setup config show`, and reset it with `agent-setup config reset`. A file with an unknown key does not load; fix it or run `agent-setup config reset`.

| Setting | config.json key | Default | What it does |
| --- | --- | --- | --- |
| `context-warn-percent` | `contextWarnPercent` | `18` | Context use, as a whole percent of the model window, that starts the handoff warning (18 means 18%). |
| `context-block-percent` | `contextBlockPercent` | `20` | Context use, as a whole percent of the model window, that blocks new code edits. |
| `autorun-default-cycles` | `autorunDefaultCycles` | `10` | Compact cycles /autorun allows when no count is given. |
| `autorun-max-cycles` | `autorunMaxCycles` | `50` | Hard limit on compact cycles for one autorun, whatever count is given. |
| `autorun-check-every-seconds` | `autorunCheckEverySeconds` | `5` | Seconds between the autorun watcher's checks. |
| `autorun-idle-after-seconds` | `autorunIdleAfterSeconds` | `8` | Seconds without transcript activity before autorun treats the turn as idle. |
| `idle-compact-after` | `idleCompactAfter` | `"off"` | How long an agent session sits idle before agent-setup submits a waiting draft or runs /compact: off, or a time like 30s, 2m, 1h. |
| `duplicate-code-mode` | `duplicateCodeMode` | `"block"` | What the duplicate-code guard does with a copied function or type shape: block the edit, warn, or off. |
| `duplicate-code-skip-folders` | `duplicateCodeSkipFolders` | `[]` | Folder names the duplicate-code guard skips, on top of its built-in skips such as node_modules. |
| `session-rehome-roots` | `sessionRehomeRoots` | `["Desktop/Code","Code","Projects","dev","src","repos"]` | Folders (home-relative or absolute) whose git repos session-rehome may move Claude Code and Codex sessions into. Repos are found one and two levels deep. |
| `disk-cleanup-roots` | `diskCleanupRoots` | `["Desktop/Code","Code","Projects","dev","src","repos"]` | Folders (home-relative or absolute) whose git repos disk-cleanup checks for finished worktrees to push and remove, and for unpushed branches to push. Repos are found one and two levels deep. |
| `debug-logs` | `debugLogs` | `false` | Print agent-setup hook errors to stderr. |

Lists (`duplicate-code-skip-folders`) take comma-separated values on the command line.

### Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `AGENT_SETUP_AGENT_ID` | set by agent-setup in hook commands | Which agent ran a hook (claude-code, codex, grok). Install writes AGENT_SETUP_AGENT_ID=<agent> in front of the hook commands that read it: idle compact, session rehome, and the scratch cleanup question. |
| `AGENT_SETUP_IDLE_COMPACT_AFTER` | unset (idleCompactAfter in config.json applies) | Overrides idleCompactAfter for one agent session: off, or a time like 30s. Set it when starting the agent, e.g. `AGENT_SETUP_IDLE_COMPACT_AFTER=30s codex`. |
| `AGENT_SETUP_AUTORUN_DRY_RUN` | off | When 1, true, or yes, the autorun watcher logs the keystrokes it would type instead of typing them (safe manual testing). |
| `AGENT_SETUP_REHOME_STATE_DIR` | ~/.claude/agent-setup/state/session-rehome for a global install, .claude/agent-setup/state/session-rehome for a project install | Folder for session-rehome's ledger of moved, kept, and deleted sessions, its watcher lock, and its sweep stamp. Tests point it at a temporary folder. |
| `AGENT_SETUP_DISK_CLEANUP_STATE_DIR` | ~/.claude/agent-setup/state/disk-cleanup for a global install, .claude/agent-setup/state/disk-cleanup for a project install | Folder for disk-cleanup's watcher lock, the stamp that limits the cache cleanup to once a day, the list of kept worktrees to look at again, and the log of what each pass did. Tests point it at a temporary folder. |
<!-- AUTO:SETTINGS:END -->

## Scope

This repository is the source of truth for agent-setup-owned skills and hooks. It is not a general agent marketplace, does not install arbitrary third-party skill folders, and does not own runtime behavior for every agent listed above. When a platform cannot enforce a hook before an edit, agent-setup documents the limit and provides the closest check it can support.

The hook code is intentionally small: compiled JavaScript, Node built-ins, and agent-setup's own shared hook library. The CLI can use dependencies; hook files should stay zero-dependency.

## Repo docs

- [AGENTS.md](AGENTS.md) — repo conventions, ownership, and validation commands for coding agents.
- [PROJECT.md](PROJECT.md) — product direction and repository purpose.
- [CONTEXT.md](CONTEXT.md) — domain context.
- [LANGUAGE.md](LANGUAGE.md) — naming and terminology.
- [src/templates/projectDocs/CODE-STYLE.md](src/templates/projectDocs/CODE-STYLE.md) — reusable code-style template installed into other repos.

## Official references

- [Claude Code overview](https://code.claude.com/docs/en/overview)
- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [AGENTS.md convention](https://agents.md/)
- [OpenAI Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- [Cursor rules](https://cursor.com/docs/rules)
- [GitHub README guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- [GitHub Actions](https://docs.github.com/en/actions)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

## Development

```bash
pnpm install
pnpm generate-readme
pnpm test
pnpm typecheck
pnpm build
pnpm verify
```

`pnpm generate-readme` rewrites only the marked feature, skill, and settings sections above from `src/catalog/featureCatalog.ts`, `src/skills/*/SKILL.md`, `src/config/configSchema.ts`, and `src/config/environmentVariables.ts`. The pre-commit hook runs `pnpm verify`, whose `generate-readme:check` fails on a stale README; it never rewrites or stages files, so run `pnpm generate-readme` yourself.

## License

[MIT](./LICENSE) © Yosef Hayim Sabag
