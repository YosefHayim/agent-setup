---
name: restructure-repo
description: Use when a whole repo needs a better structure — folders, file names, function, variable, and type names, function bodies, import order, repeated code, comments, and dependencies. It starts from the no-AI code-standard fixes and score, then checks the repo against the official docs of every framework it uses (Expo, React, Cloudflare, Express…) and the repo's own PROJECT.md, README.md, and LANGUAGE.md. Cheap read-only scout agents scan; the main agent decides, shows one review page for approval, and makes the changes on a branch, phase by phase. Also for "clean all my repos". Say "restructure this repo", "better project structure", "rename across the codebase", or "which deps do we not need". Not for one file or folder; use make-code-readable or simplify-code.
type: flow
---

# Restructure repo

Bring a whole repo in line with what it is for, in the fewest lines that do the job. `code-standard` fixes and scores the repo with no AI, scouts read, the main agent decides and edits, and the user approves the phases on one review page.

## Rules

Measure every finding against these, in order:

1. **The code standard.** The [`code-standard`](https://github.com/YosefHayim/code-standard) rules plus the repo's `AGENTS.md` section `## Exceptions to code-standard` win. `PROJECT.md` says what the project is for, `LANGUAGE.md` gives its words and swaps, `CONTEXT.md` and `README.md` describe it. Anything that breaks a rule, does not fit what the docs describe, or does not use their words, is a finding.
2. **Official docs** of each framework and library in use, for the installed version.
3. **Minimal.** The fewest lines, files, and layers that do the job. There is no line cap per file; the test is that adding or changing one feature means reading only that feature's files.
4. **Simple.** When the docs allow several ways, pick the one a person can debug by hand.
5. **Names over comments.** Rename until a comment on a function, prop, or type is not needed, then delete the comment. Keep tool directives (`@ts-expect-error`, `biome-ignore`, `eslint-disable`), a comment that links the issue behind a workaround, license headers, and doc comments that generate published API docs.

## Safety

- Never commit on main or the default branch. Stop if tracked files have uncommitted changes.
- Change no tracked file until the user has approved the Fix step or the review page. Before that, write only the run folder.
- Create `refactor/<goal>` in this checkout before the Fix step: 2–4 words that say why, no date (`refactor/split-app-and-api`).
- `code-standard fix` needs a clean tree, never commits and never removes files. Read `git diff` before you commit its changes.
- Move files with `git mv`. Make one commit per phase, or one per app or package when a phase is large.
- Keep behavior. A change to an API response, route, env var, or public export gets its own question.
- Ask before a major version upgrade, a deploy, a secret change, or a paid service.
- Check deploy config (`wrangler.*`, `eas.json`, `app.json`) with dry runs only.
- Expo Router files are routes: each rename gets its own question.
- Use plain pnpm or npm workspaces. Never add Turborepo or Nx; flag an existing one only when it adds nothing.
- Add a shared abstraction only when it has two or more real callers and removes lines.
- Scouts never edit, commit, or decide. A finding reaches a question card only after the main agent has read it at its `file:line`.
- Every finding names its source: an official doc URL, a line in the repo's docs, or `judgment`. Never cite a doc from memory.

## Who does the work

| Role | Model | Does |
|---|---|---|
| Scout | The model the user picks in step 1, read-only | Runs tools, reads files, fetches doc pages, and returns the table in [EXAMPLES.md → Scout brief](EXAMPLES.md#scout-brief) |
| Main agent | The session model | Runs `code-standard`, checks and ranks findings, writes the review page, edits, runs checks, commits |

- Spawn scouts explicitly; some hosts delegate only when asked.
- At most 8 scouts at once, one per app or package per phase; batch small ones together and start the next as one finishes.
- Give each scout the lines of `findings.md` for its area (grep the file by path), so it reads real `file:line` hits and does not search from zero. Never paste the full findings or the HTML into the conversation.
- Save each scout report under `### <phase>: <area>` in the Report section of `$REPORT`, and reuse it on resume.
- On a host without subagents, scan in the main agent and tell the user this run costs more.

## Workflow

Copy this checklist into the `## Plan` section of `$REPORT` and tick it as you go:

```text
- [ ] 1. Start
- [ ] 2. Read
- [ ] 3. Fix
- [ ] 4. Score
- [ ] 5. Official docs
- [ ] 6. Baseline
- [ ] 7. Review page
- 8. Phases
  - [ ] Phase 1: Dead weight
  - [ ] Phase 2: Structure
  - [ ] Phase 3: Code
  - [ ] Phase 4: Names
  - [ ] Phase 5: Deps
  - [ ] Phase 6: Best practices
- [ ] 9. Wrap up
```

### 1. Start

Find the models this host offers right now, as [REFERENCE.md → Scout models](REFERENCE.md#scout-models) describes. Never assume a model name.

Ask one card before any scout runs:

- **Scout model:** the fastest, cheapest model the host offers first, marked `(Recommended)`, then the stronger ones, each with its cost and care trade-off. The main agent stays on the session model.
- **Resume:** only when the run folder the user gives, or the newest one (`ls -1 "$RUNS" | tail -n 1`, with `RUNS` as set below), has a Plan section with unticked lines; resume from the first one.

Otherwise start a run, and write the picked models to the Plan section. Ask for the goal too, and create the branch once the Read step is done:

```bash
SKILL="restructure-repo"
COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
REPO_ROOT=$(dirname "$COMMON_GIT_DIR")
REPO=$(basename "$REPO_ROOT")
RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/$SKILL"
RUN_DIR="$RUNS/$(date +%Y-%m-%d-%H%M)"
[ -e "$RUN_DIR" ] && RUN_DIR="$RUN_DIR-$$"
mkdir -p "$RUN_DIR"
REPORT="$RUN_DIR/report.md"
```

### 2. Read

Scouts read `git ls-files`, every package manifest, the workspace and framework configs, CI, and the repo's docs. Write to the Report section: each framework with its installed version, and each surface (client, server, shared, deploy) with its path.

If `PROJECT.md` or `LANGUAGE.md` is missing, offer `question-my-plan` to write them first. If the user declines, use `README.md` and the words the code already uses most (`nameWords` in step 4 lists them).

Then run `git switch -c refactor/<goal>`.

### 3. Fix

No AI in this step. On the `refactor/<goal>` branch with a clean tree (`git status --short` prints nothing):

```bash
code-standard fix --html-output "$RUN_DIR/standard"
```

When the repo has not adopted code-standard (no `code-standard` in `package.json`), run `pnpm dlx code-standard@<latest> fix --html-output "$RUN_DIR/standard"`, with the latest version from `pnpm view code-standard version`.

Fix applies only safe changes: the repo checks (`biome.json`, `package.json`, `.env.example`, lockfile), unused exports and deps, code fixers, `git mv` renames, Biome, Ruff when there are `.py` files, and install. It never removes files and never commits. Outside a terminal it prints `<repo> health A% -> B%, N files changed (review with git diff)`, then the `report` and `findings` lines. Exit 0 is clean, 1 means findings remain (normal here), 2 means it refused to start: fix the cause (usually a dirty tree) and run it again.

Fix reports renames it skipped (a name that already exists, for example) as counts; those stay findings for phases 2 and 4. If lint now says it cannot resolve `code-standard/biome`, the install step did not finish: run the package manager's install and read the `needs you` lines in the fix output.

Then run the repo's checks (typecheck, lint, tests, build). A fix that breaks a check is fixed by hand or reverted file by file. Then commit once: `Apply code-standard fixes`.

### 4. Score

```bash
code-standard check --html-output "$RUN_DIR/standard" --json-output "$RUN_DIR/check.json"
```

Use `pnpm dlx code-standard@<latest> check` when the repo has not adopted it. Outside a terminal it prints three lines: the health line, `report file://.../index.html` and `findings .../findings.md`. Exit 1 only means findings remain.

Write to the Report section: the score before the Fix step and now, the top rules (`ruleCounts` in `check.json`, most findings first), the failed repo checks, and both links. Keep `check.json` for the review page: `findings` (rule, file, line, message), `nameWords` and `repoChecks`. Read `findings.md` and `check.json` with grep or a script, never into the conversation.

### 5. Official docs

For each framework and main library from step 2, a scout fetches its structure, best-practice, and style pages for the installed version and returns quotes with URLs. Start from [REFERENCE.md → Official docs](REFERENCE.md#official-docs); for anything not listed, find the official site.

### 6. Baseline

Run typecheck, lint, build, and tests. Start each app in the background, wait until it is ready or 2 minutes pass, then stop it. Write each command and result to the Report section. If tests are thin, say so, offer `find-missing-tests`, and continue.

### 7. Review page

Scouts scan every phase's targets (the table in step 8) at once, and return their findings. The main agent reads each finding at its `file:line`, drops the wrong ones, and ranks the rest.

Then write `$RUN_DIR/review.html`: one static page with inline CSS, light and dark colors, a layout that fits a phone width, and no scripts. Escape every repo string (file names, code, names) before it goes into the page. It holds:

1. **Score.** Before and after the Fix step, and a link to the code-standard report page (`$RUN_DIR/standard/index.html`) for the rule counts. Do not rebuild them.
2. **Tree.** Current tree next to the proposed tree, then the move table (from, to, why, source).
3. **Names.** The rename table. Add the proposed `LANGUAGE.md` swaps, built from `nameWords`: when two words name one thing (`order` and `trade`), propose `| Avoid in code | Use |` rows, so one thing has one name.
4. **Code.** Before and after for the biggest wins, with `file:line`.
5. **Stack fits purpose.** Each framework and main library next to what `PROJECT.md` says the project is for, with the official doc link. A change of stack is report-only and gets its own question.
6. **Deps.** The findings of phase 5.

Open it with `open "$RUN_DIR/review.html"` (`xdg-open` on Linux). Ask one card: **approve all phases**, **pick phases**, or **stop**. [EXAMPLES.md → Review page](EXAMPLES.md#review-page) shows the outline. Close the page after the answer.

### 8. Phases

Apply only the phases the user approved on the review page, in the order below. For each phase:

1. Apply the approved changes from the review page. Ask an extra question only for what the review page marked as its own question (a stack change, a route rename, a public API).
2. Re-run the repo's checks and `code-standard check --html-output "$RUN_DIR/standard" --json-output "$RUN_DIR/check.json"`. A phase that lowers the score or breaks a check is fixed or reverted before going on.
3. Commit `refactor(<phase>): <what changed>`, then append the result, the new score and the SHA to the Report section and tick the Plan checklist.

| Phase | Targets |
|---|---|
| 1. Dead weight | Unused files (`no-unused-files` in `findings.md`), and code or folders unrelated to what `PROJECT.md` and `README.md` describe. Fix already removed unused exports and deps |
| 2. Structure | Folders: the proposed tree and move table; move with `git mv` and check imports, Metro and EAS config, wrangler paths |
| 3. Code | Apply `simplify-code`, then `make-code-readable`, across the repo: function bodies (one job, flat, early returns), repeated code merged into one shared version, and the `findings.md` hits for the code rules |
| 4. Names | Files, functions, variables, types, interfaces, and props: each says what it does, in `LANGUAGE.md`'s words and the framework's casing. Add the approved swaps to `LANGUAGE.md` first, so the check enforces them. Delete the comments the new names replace (Rules → 5) |
| 5. Deps | Wrong section, duplicates, replaceable by a built-in, version mismatches, outdated majors (report only), and one line on why each remaining dep exists. Commands: [REFERENCE.md → Dependency checks](REFERENCE.md#dependency-checks) |
| 6. Best practices | Each framework against its step 5 docs. Each finding gives `file:line`, doc URL, fix, and effort. Send env and secret findings to `fix-env-config` |

The order is delete, move, rewrite, then name, so each phase leaves less work for the next.

### 9. Wrap up

- When the repo has not adopted code-standard, run `code-style` in Adopt mode. It installs the package and the shared Biome config, and replaces `CODE-STYLE.md` with an `## Exceptions to code-standard` section in `AGENTS.md`.
- Show a short "Project structure" section for `README.md`, and the `AGENTS.md` layout table change when there is one (or offer `update-agent-docs`). Apply them after approval in one `docs:` commit.
- Run `code-standard check` one last time and report the score before the Fix step and now.
- Push and open a PR only when the user asks, through `finish-and-push`.

### Many repos

When the user asks to clean all repos, run first:

```bash
code-standard check --repos-folder <folder> --html-output "$RUN_DIR/standard" --json-output "$RUN_DIR/check.json"
```

Its report page names the "Clean first" repo, also `modelRepo` in `check.json`. Start with that repo. Do one repo per run (its own run folder and branch), then go back to the report for the next one.

For a big rewrite that needs tests first, hand off to `simplify-repo-with-tests`. For why a framework is used at all, hand off to `explain-my-stack`.

## Verification

Report:

- the branch and the commit SHAs;
- for each phase, the counts and the table of what was deleted, moved, rewritten, or renamed, with sources;
- the score before the Fix step and now, with the report links;
- the baseline and final check results side by side;
- skipped phases and remaining risks;
- the `report.md` path, last.

The run is done when every approved phase is committed and the final checks match or beat the baseline.
