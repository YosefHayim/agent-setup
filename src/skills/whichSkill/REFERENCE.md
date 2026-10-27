# Which skill — freeform → skill map

Use this as a quick lookup. Prefer **one primary** skill.

## Delivery & git

| You say… | Primary | Notes |
|----------|---------|--------|
| git commit push, wrap up, open PR, report when done | `finish-and-push` | Topic branch by default; no remote delete |
| split commits, conventional messages only | `organize-commits` | Outer loop still finish-and-push if “done” means handoff |
| new branch + small edit + PR | `finish-and-push` | Not clean-repo-by-feature |
| one feature fully to main (tests, CI, merge, reinstall) | `ship-one-feature` | `/ship-one-feature` or existing `#N`; reuses run-tasks-in-parallel + finish-and-push |
| test gaps unit/MSW/e2e scan then TDD | `find-missing-tests` | `/find-missing-tests`; headless e2e default |
| over-engineering scan + before/after + TDD prove | `simplify-repo-with-tests` | `/simplify-repo-with-tests`; reuses simplify-code; headless e2e default |
| test gaps parallel lanes merge to main | `ship-missing-tests` | `/ship-missing-tests`; resume report; default merge after gates |
| numbered task list full SDLC one agent each | `run-tasks-in-parallel` **execute** | `/run-tasks-in-parallel` |
| merge many worktrees / salvage lanes | `run-tasks-in-parallel` **land-lanes** | |
| spawn many agents / `.worktrees/` / one issue per lane | `run-tasks-in-parallel` **setup-lanes** | |
| whole messy repo, every feature, backup main | `clean-repo-by-feature` | |

## Quality of code / structure

| You say… | Primary |
|----------|---------|
| deslop, AI slop, kill ceremony, ban payload/result (local/scope) | `simplify-code` |
| identify over-engineering whole repo, prove lean, fewer files/LOC same behavior | `simplify-repo-with-tests` |
| make readable / rename for clarity | `make-code-readable` |
| restructure whole repo / better project structure / rename across the codebase / which deps do we not need / clean all my repos / score and fix this repo | `restructure-repo` |
| CODE-STYLE grill or compliance audit, new or existing repo | `code-style` (new / existing / audit mode) |
| teach stack choices | `explain-my-stack` |
| plan / design grill, with or without project docs | `question-my-plan` |

## Prove it works

| You say… | Primary |
|----------|---------|
| launch local, playwright, e2e, don’t deploy | `run-local-and-check` |
| run CI locally, act, Actions blocked by billing | `run-ci-locally` |
| scan/fill missing unit mocks e2e per feature (TDD) | `find-missing-tests` |
| over-engineering kill list + TDD parity + headless e2e | `simplify-repo-with-tests` |
| missing tests campaign worktrees PRs merge | `ship-missing-tests` |
| redeploy, is live, production smoke | `deploy-and-check` |
| /fix-bug, reproduce then fix, fix these bugs | `fix-bug` |

## Meta / skills / sessions

| You say… | Primary |
|----------|---------|
| which skill / refine my prompt / too many skills | **`which-skill`** (this) |
| fix this skill from feedback | `improve-skill` |
| scan sessions for repeated work | `find-repeated-prompts` |
| bench skill A vs B | `benchmark-agents` |
| turn what we just did into a skill | `save-as-skill` |
| add a new skill / make a skill that… / new skill from a description | `add-skill` |
| sync skills to all agents | `install-skills` |

## Repo / platform utilities

| You say… | Primary |
|----------|---------|
| kill ports except metro | `free-ports` |
| clone all GH repos into Code | `clone-all-repos` |
| wrangler / D1 / KV ops | `manage-cloudflare` |
| README / AGENTS docs set | `write-readme` |
| Chrome Web Store listing SEO | `chrome-store-seo` |
| mobile store release | `release-mobile-app` |

## Design

| You say… | Primary |
|----------|---------|
| design my app idea, mock up this idea, premium UI, Framer-level mockup, wireframes then final UI | `design-app-mockup` |
| easier flows in an existing app, fewer clicks, UX audit | `improve-ux` |
| this screenshot or design as exact code | `image-to-code` |

## Agent artifact paths (anti-slop)

Run records are **not** product SSOT. Each run gets one new folder outside every repo, **`${XDG_STATE_HOME:-~/.local/state}/agent-setup/runs/<repo>/<skill>/<YYYY-MM-DD-HHMM>/`**, with one `report.md` that holds the run as `##` sections. Separate files only for assets that are not Markdown. Resume uses the run folder the user gives, else the newest one; there is no pointer file. Parallel lanes share the orchestrator's `RUN_DIR`. Never write run records to:

- the repository root (reports, audits, campaign boards)
- a `docs/` folder or a gitignored folder in the repository

Agent config (issue tracker, triage labels, domain notes) goes in `AGENTS.md` sections. Decisions go in the PR description.

| Skill | Sections in `report.md` | Assets |
|-------|-------------------------|--------|
| run-tasks-in-parallel | Board, State | none |
| find-missing-tests | Features, Report | none |
| ship-missing-tests | Ship (reads the newest find-missing-tests `report.md`) | none |
| simplify-repo-with-tests | Features, Report | none |
| restructure-repo | Plan (checkbox lines), Report | none |
| code-style | Findings | none |
| clean-repo-by-feature | Matrix, State, Audit, Health | planpage JSON |
| improve-ux | State, Matrix, Audit, Taste | `mocks/` |
| benchmark-agents | Report | `results.json` |
| find-repeated-prompts (repo `global`) | Report | the script's output files |

Root stays for: README, AGENTS, CODE-STYLE, PROJECT, CONTEXT, LANGUAGE.

## Anti-patterns

- Using `clean-repo-by-feature` for a one-line string change  
- Using `deploy-and-check` when they said “run local only”  
- Creating a new skill for a one-off edit  
- Naming five primaries — pick **one** primary, rest supporting  
- Dropping agent report MD on the repository root  


## Template refined prompts

These strings are what should land **in the agent input** (STT inject) or be executed **same-turn** — not a multi-page plan.

**Branch + line edit + PR (no merge):**

```text
finish-and-push: create branch feat/<slug>, apply this exact text change: "<…>",
open PR to main, do not merge, report branch + PR URL + SHA.
```

**One feature all the way to main (tests + CI + merge + reinstall):**

```text
/ship-one-feature <feature description>
/ship-one-feature #2
```

**Numbered tasks → one agent each → full SDLC:**

```text
/run-tasks-in-parallel
1. …
2. …
/run-tasks-in-parallel merge
1. …
```

**Scan test gaps (unit + mocks + e2e) then TDD fill; headless e2e default:**

```text
/find-missing-tests
/find-missing-tests scan-only
/find-missing-tests headed
/find-missing-tests surface=web
```

**Identify over-engineering; kill with parity tests; headless e2e default:**

```text
/simplify-repo-with-tests
/simplify-repo-with-tests scan-only
/simplify-repo-with-tests apply
/simplify-repo-with-tests headed
```

**Test gaps all the way: parallel lanes + merge (after gates):**

```text
/ship-missing-tests
/ship-missing-tests resume residual-only
/ship-missing-tests no-merge
/ship-missing-tests max-lanes=6
```

**Messy multi-feature cleanup:**

```text
clean-repo-by-feature: backup main, inventory features, one agent per feature,
issue + branch + PR each, no merge until I review.
```

**Unsure (advice only):**

```text
which-skill: here is my raw ask — <paste> — primary skill + paste-ready refined prompt only.
```

## Seamless UX (how to do this right)

```text
[STT hold-Shift release] or [typed draft]
        │
        ▼
  route-aware refine  (which-skill rules + preserve literals)
        │
        ▼
  insert into focused input  (type_text / caret — user sees it)
        │
        ▼
  user hits Enter  →  normal agent turn in SAME session
        │
        ▼
  primary skill runs (finish-and-push, simplify-code, …)
```

| Approach | Feels like | Use |
|----------|------------|-----|
| Refine → **input** → Enter | Talking to one agent | STT / pre-send (preferred) |
| Messy Enter → **same turn** silent route + execute | One reply, work happens | Typed freeform already sent |
| Separate “routing chat” then restart | Interrupt / context switch | **Avoid** |
| Manual Cmd+C / Cmd+V as the product | Clunky | Only internal to `type_text` |

Existing pieces live in **agent-voice**, a separate app: its dictation pastes into the caret, and its prompt refinement can run on the final transcript before typing the refined prompt into the caret (mode A). See the agent-voice docs for its settings.
