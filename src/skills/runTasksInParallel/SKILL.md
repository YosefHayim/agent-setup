---
name: run-tasks-in-parallel
description: Use when you have a numbered list of tasks and want one agent per task. Each task gets its own branch, folder, tests, and PR. It can also only set up the branches, or only merge finished ones. Say "one agent per task" or "run these tasks in parallel". For one feature, use ship-one-feature.
type: flow
---

# Run tasks in parallel

**One slash → numbered tasks → one agent per task → full software lifecycle per lane.**

Slash: **`/run-tasks-in-parallel`**. Also triggered by “setup worktrees”, “one agent per task”, “fan out lanes”.

## Modes

| Mode | When | Outcome |
|------|------|---------|
| **execute** (default) | Numbered list / “run these tasks” / full SDLC | Each task: issue → worktree → implement → unit + e2e → UI/manual QA → commits → PR → gates → optional merge |
| **setup-lanes** | Fan-out only (siblings: clean-repo-by-feature, ship-missing-tests, simplify-repo-with-tests) | Worktree + branch + issue + `LANE-BRIEF.md` + PR path; **no** merge; gates only if brief says so |
| **land-lanes** | Salvage / integrate existing concurrent lanes | Reachable merge onto default **without** lost work |

Default when the user pastes a numbered list or says full SDLC / execute: **execute**.  
Default when a sibling says “setup-lanes” / “land-lanes”: that mode only.

One **task** = one **agent** = one **worktree** = one **branch** = one **issue** = one **PR**.

## Reuse first (do not reimplement)

| Concern | Load and follow |
|---------|-----------------|
| Commits / history shape | **`organize-commits`** |
| Verify + push + open/update PR | **`finish-and-push`** |
| Local browser / manual UI QA | **`run-local-and-check`** |
| Single feature with merge+reinstall polish | **`ship-one-feature`** (one task only — or run this skill with one line) |
| Multi-feature cleanup campaign | **`clean-repo-by-feature`** (calls this skill’s setup/land) |
| Missing tests multi-lane campaign | **`ship-missing-tests`** |
| Production live prove | **`deploy-and-check`** only if user asks |

This skill owns: task parsing, lane isolation, SDLC mandate, matrix board, merge sequencing when authorized. Details: [REFERENCE.md](REFERENCE.md).

## Safety

- **Never** commit product work on the default branch. Topic branches only.
- **Never** delete remote branches, tags, or PRs unless the user explicitly asks.
- **Own-lane isolation:** each agent edits only its worktree and path globs. Foreign dirty trees are user-owned.
- Reject or **sequence** tasks that share the same files/schemas until land order is clear.
- Freeze or coordinate active writers before **land-lanes**. Snapshots go stale while another agent writes.
- No broad reset/clean/checkout-overwrite, blanket stash, forced branch switch, shared rebase, or `ours`/`theirs` conflict strategy.
- Treat untracked, ignored-but-important, symlink, mode, submodule, sparse-checkout, detached-HEAD, and sequencer state as first-class data.
- **execute** authorizes per-lane merge **only** when the user said merge / “to main” / full ship, **and** hard gates pass (unit + e2e green, confidence ≥ 6). Default without merge language: **open PR only**.
- Headless e2e default. Headed only if user said `headed` / `visible` / `ui`.
- Never print secrets from `.env` / fixtures.
- Agent host is agnostic: host subagents, **cmux** per lane, or briefs-only.

## Workflow

### 0. Choose mode

| Signal | Mode |
|--------|------|
| Numbered list, `/run-tasks-in-parallel`, “full SDLC”, “run these tasks” | **execute** |
| “setup worktrees”, “fire agents”, sibling **setup-lanes** | **setup-lanes** |
| “land worktrees”, salvage, consolidate concurrent lanes | **land-lanes** |
| Both setup + land | Finish setup for unfinished lanes, then land only ready ones |

### Mode: execute (default — full SDLC)

#### 1. Parse tasks

1. Repo root, default branch from `origin/HEAD`, `git fetch` (do not mutate other worktrees).
2. Read `AGENTS.md`, `CODE-STYLE.md`, package verify/test scripts.
3. Split the request into **independent** numbered tasks. Accept forms: `1. …`, `1) …`, `- [ ] …`, or explicit “Task N:”.
4. Name each with a short kebab slug. Flag overlaps; sequence or batch only when paths do not collide.
5. Start a run: one new folder outside the repo, never a file that parallel runs overwrite:

   ```bash
   SKILL="run-tasks-in-parallel"
   COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
   REPO_ROOT=$(dirname "$COMMON_GIT_DIR")
   REPO=$(basename "$REPO_ROOT")
   RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/$SKILL"
   RUN_DIR="$RUNS/$(date +%Y-%m-%d-%H%M)"
   [ -e "$RUN_DIR" ] && RUN_DIR="$RUN_DIR-$$"
   mkdir -p "$RUN_DIR"
   REPORT="$RUN_DIR/report.md"
   ```

   Write the board as the `## Board` section of `$REPORT` (and an optional `## State` section). Put `RUN_DIR` in every `LANE-BRIEF.md` so all lanes share this run. Resume → use the run folder the user gives, else the newest one: `ls -1 "$RUNS" | tail -n 1` (do not start a new run). Never write the board into the repository.
6. Host mode: **A** subagents (default “just run it”), **B** cmux watchable, **C** briefs only.

#### 2. Fan out lanes (same mechanics as setup-lanes)

For each task:

1. Create GitHub issue (`gh issue create`) with title, acceptance, out-of-scope — or bind existing `#N` if the line already has an issue.
2. Worktree under **repo root**:

   ```bash
   git fetch origin
   git worktree add ".worktrees/<type>-<issue>-<slug>" -b "<type>/<issue>-<slug>" "origin/<default>"
   ```

   - Branch: `feat|fix|refactor|chore|docs/<issue>-<short-slug>`
   - Dir: `.worktrees/<type>-<issue>-<slug>` (slashes → dashes). Ensure `.worktrees/` is gitignored when the repo agrees.
3. Write **`<worktree>/LANE-BRIEF.md`** with the full SDLC mandate (template in REFERENCE). Include path globs, acceptance, unit + e2e requirement, UI QA when product is UI, “no main commits”, merge policy.
4. Spawn one agent with `cwd` = worktree (or cmux workspace / brief-only). Pick its model and record it on the Board. Pass it as the Agent tool's `model`, or `--model` for a CLI lane:
   - **haiku**: mechanical edits with an exact spec and a check that proves them (rename, move, config value, regenerate).
   - **sonnet** (default): bug fixes, tests, dedup, small features.
   - **opus**: design, unclear bugs, cross-cutting refactors, or a lane that failed on sonnet.
   - Split a lane that would need more than about 100 tool calls. Every call re-reads the whole lane context.
   - Re-run a lane one model up when its checks stay red or it reports a gap it did not fix. An opus lane that still fails gets split or a sharper brief.
5. Run at most 8 lanes at once and start the next task as one finishes. More lanes do not finish sooner: with 11 to 20 agents running, file reads and shell steps get several times slower on one machine.

#### 3. Per-agent SDLC mandate (every lane)

Each agent must complete **only its task**:

1. **Clarify** acceptance against issue body; stop if blocked (record on the Board).
2. **Implement** using repo patterns (`reuse-before-build` only when build-vs-buy is ambiguous).
3. **Unit happy path** — add/extend; run repo unit command → green. Hard stop if red.
4. **E2E/integration happy path** — real suite or smallest durable e2e; headless default → green. Hard stop if red when stack exists; honest skip only if env missing (cap confidence).
5. **Manual / UI QA** — load **`run-local-and-check`** for user-visible web/app flows; record evidence or N/A.
6. **Commits** — **`organize-commits`** on the topic branch only.
7. **Ship pre-merge** — **`finish-and-push`**: verify, push, open/update PR with `Fixes #<n>`, Summary, Confidence 1–10, test plan (unit/e2e/QA/act).
8. **act / CI** when workflows exist — red blocks merge.
9. **Merge** only if orchestrator authorized and confidence ≥ 6; else stop at open PR.
10. **Do not** delete remotes; do not touch other lanes.
11. **Lane habits** from the brief: waits that end on failure too, deletes by literal path, heavy tools stopped when done.

#### 4. Orchestrator after lanes

1. Refresh the Board section: task → issue → worktree → branch → model → PR → unit → e2e → QA → confidence → merge.
2. If merge authorized: order merges (contracts → domain → UI → e2e-heavy last); `gh pr merge`; rebase remaining open PRs on conflicts; never force-push default.
3. Optional reinstall/smoke on default tip when user asked full ship (see REFERENCE).
4. Done receipt (Verification section). Unfinished lanes stay open.

Flags: `no-merge` (default without merge language), `merge` / `to-main`, `no-cmux`, `headed`, `agent=grok|claude|codex`, `max-lanes=N` (default 8 running at once).

### Mode: setup-lanes

Same fan-out as execute steps 2–3 **without** forcing full SDLC gates unless the calling skill’s brief requires them. Each lane: implement → narrow/full verify as brief says → **`organize-commits`** + **`finish-and-push`** push/PR. **Do not merge** unless asked. Report matrix. Used by clean-repo-by-feature / ship-missing-tests / simplify-repo-with-tests / improve-ux.

### Mode: land-lanes

1. Target = remote default (or named product tip). Fetch without mutating worktrees.
2. Inventory every worktree (include `.worktrees/*`): path, branch, upstream, ahead/behind, dirty, ignored-important, stash, sequencer.
3. Classify: clean committed, dirty-only, already reachable, patch-equivalent, divergent, blocked. Use patch-ID + history, not subjects alone.
4. Map path and semantic overlap (schema/consumer, API/caller, migration/model).
5. Backup refs for target and every committed source. Preserve dirty/untracked with verified methods.
6. Make each lane reviewable (`organize-commits` when authorized). Prefer landing via open PRs.
7. Integrate one logical lane at a time; mechanical conflicts only when intent is clear; stop on competing logic.
8. Focused checks per lane; full gate after convergence.
9. Prove original commits + preserved artifacts reachable **before** proposing local cleanup. Remote delete still forbidden unless user asks.

## Verification

### execute

```text
mode: execute
repo: <path>
default: <branch> @ <sha>

host: A|B|C
lanes:
  - N | task | issue | worktree | branch | pr | unit | e2e | qa | confidence | merge
skills_reused: organize-commits, finish-and-push, run-local-and-check[, …]
residual: <blocked / deferred / overlaps>
report: <RUN_DIR>/report.md
```

Done only when each started lane has issue + worktree + branch + PR (or honest block), unit/e2e evidence (or skip reason), no default-branch product commits, no remote deletes, and merges only when authorized + gates green. **“Agents ran” is not done.**

### setup-lanes

Per lane: path, branch, issue URL, host/cmux, `LANE-BRIEF.md`, PR URL, head SHA, verify outcome; no default commits; no remote deletes; leftover unassigned tasks listed.

### land-lanes

Matrix of every worktree disposition, backups, merge order, conflicts, focused + full gate results, reachability proof, cleanup authorization (local vs remote separate).

“Everything landed” = reachability + byte preservation — not empty `git status` alone.  
“Agents fired” = issue + branch + PR per lane — not directories alone.
