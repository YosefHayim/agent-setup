---
name: run-tasks-in-parallel
description: Use when you have a numbered list of tasks and want one agent per task. Each task gets its own branch, folder, tests, and PR. It can also only set up the branches, or only merge finished ones. Use it for a long run, a run overnight, or work that must survive memory loss across waves. Also use it for one big job that needs more than 8 PRs or several waves, even when the user does not say parallel. Say "one agent per task" or "run these tasks in parallel". For one feature, use ship-one-feature.
type: flow
---

# Run tasks in parallel

**One slash → numbered tasks → one agent per task → full software lifecycle per lane.**

Slash: **`/run-tasks-in-parallel`**. Also triggered by “setup worktrees”, “one agent per task”, “fan out lanes”.

## Modes

| Mode | When | Outcome |
|------|------|---------|
| **execute** (default) | Numbered list / “run these tasks” / full SDLC | Each task: issue → worktree → implement → commits → PR → optional merge; the end check runs once after the last merge |
| **setup-lanes** | Fan-out only (siblings: clean-repo-by-feature, ship-missing-tests, simplify-repo-with-tests) | Worktree + branch + issue + `LANE-BRIEF.md` + PR path; **no** merge; no checks in the lane |
| **land-lanes** | Salvage / integrate existing concurrent lanes | Reachable merge onto default **without** lost work |

Default when the user pastes a numbered list or says full SDLC / execute: **execute**.  
Default when a sibling says “setup-lanes” / “land-lanes”: that mode only.

One **task** = one **agent** = one **worktree** = one **branch** = one **issue** = one **PR**.

## Reuse first (do not reimplement)

| Concern | Load and follow |
|---------|-----------------|
| Commits / history shape | **`organize-commits`** |
| Push + open/update PR | **`finish-and-push`** |
| Local browser / manual UI QA | **`run-local-and-check`** |
| Single feature with merge+reinstall polish | **`ship-one-feature`** (one task only — or run this skill with one line) |
| Multi-feature cleanup campaign | **`clean-repo-by-feature`** (calls this skill’s setup/land) |
| Missing tests multi-lane campaign | **`ship-missing-tests`** |
| Production live prove | **`deploy-and-check`** only if user asks |

This skill owns: task parsing, lane isolation, SDLC mandate, matrix board, merge sequencing when authorized, long runs. Details: [REFERENCE.md](REFERENCE.md).

## Safety

- **Never** commit product work on the default branch. Topic branches only.
- **Never** delete remote branches, tags, or PRs unless the user explicitly asks.
- **Own-lane isolation:** each agent edits only its worktree and path globs. Foreign dirty trees are user-owned.
- Reject or **sequence** tasks that share the same files/schemas until land order is clear.
- Freeze or coordinate active writers before **land-lanes**. Snapshots go stale while another agent writes.
- No broad reset/clean/checkout-overwrite, blanket stash, forced branch switch, shared rebase, or `ours`/`theirs` conflict strategy.
- Treat untracked, ignored-but-important, symlink, mode, submodule, sparse-checkout, detached-HEAD, and sequencer state as first-class data.
- **execute** authorizes per-lane merge **only** when the user said merge / “to main” / full ship, **and** the lane reports an open PR with confidence ≥ 6. Lanes run no checks; the end check runs once after the last merge. Default without merge language: **open PR only**.
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
2. Read `AGENTS.md`, the rules in `~/.claude/rules/`, package verify/test scripts.
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

   Write the board as the `## Board` section of `$REPORT` (and an optional `## State` section). Put `RUN_DIR` in every `LANE-BRIEF.md` so all lanes share this run. Resume → use the run folder the user gives, else the newest one: `ls -1 "$RUNS" | tail -n 1` (do not start a new run). Never write the board into the repository. A run that meets the Long run rule also uses [Long run mode](#long-run-mode).
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
   - Re-run a lane one model up when it reports a gap it did not fix. An opus lane that still fails gets split or a sharper brief.
5. Run at most `max-lanes` lanes at once (8 unless the user sets another number) and start the next task as one finishes. More lanes do not finish sooner: with 11 to 20 agents running, file reads and shell steps get several times slower on one machine.

#### 3. Per-agent SDLC mandate (every lane)

Each agent must complete **only its task**:

1. **Clarify** acceptance against issue body; stop if blocked (record on the Board).
2. **Implement** using repo patterns (`reuse-before-build` only when build-vs-buy is ambiguous).
3. **Unit happy path** — add or extend the test. Do not run it: lanes run no checks while building. The end check runs it.
4. **E2E/integration happy path** — add the smallest durable e2e test for the happy path. Do not run it.
5. **Manual / UI QA** — for user-visible web/app flows, write down the flow to prove. The orchestrator proves it in the real app after the end check (**`run-local-and-check`**).
6. **Commits** — **`organize-commits`** on the topic branch only.
7. **Ship pre-merge** — **`finish-and-push`**: push, open/update PR with `Fixes #<n>`, Summary, Confidence 1–10, test plan (unit/e2e/QA/check). Skip its verify step: lanes run no checks.
8. **Sign-off** — none in the lane. The orchestrator runs `gh signoff` when it merges the PR, back to back with the others (see orchestrator step 2). Never wait for a GitHub run.
9. **Merge** only if orchestrator authorized and confidence ≥ 6; else stop at open PR.
10. **Do not** delete remotes; do not touch other lanes.
11. **Lane habits** from the brief: waits that end on failure too, deletes by literal path, heavy tools stopped when done.

#### 4. Orchestrator after lanes

1. Refresh the Board section: task → issue → worktree → branch → model → PR → confidence → merge. Unit, E2E and QA stay open until the end check.
2. If merge authorized: order merges (contracts → domain → UI → e2e-heavy last). Merge one PR at a time, back to back, with no check in between: `gh signoff`, then `gh pr merge <n> --squash --match-head-commit <sha>` without `--delete-branch`. Rebase on `origin/main` only when GitHub says the PR conflicts, and push the rebase before signing off. Remove the lane worktree, keep the branch. Never force-push default. Do not wait on GitHub runs; a red run after a merge is fixed at once in its own PR.
3. End check: after the last merge, run the repo's end check once, on the latest main in a fresh worktree (`pnpm check` in Turborepo repos). Fix every failure in one PR from a fresh worktree, then run the check again until it passes. Then prove the change in the real app or flow.
4. Optional reinstall/smoke on default tip when user asked full ship (see REFERENCE).
5. Done receipt (Verification section). Unfinished lanes stay open.

Flags: `no-merge` (default without merge language), `merge` / `to-main`, `no-cmux`, `headed`, `agent=grok|claude|codex`, `max-lanes=N` (default 8 running at once).

### Mode: setup-lanes

Same fan-out as execute steps 2–3. Lanes run no checks while building. Each lane: implement → **`organize-commits`** + **`finish-and-push`** push/PR (no verify step). **Do not merge** unless asked. Report matrix. Used by clean-repo-by-feature / ship-missing-tests / simplify-repo-with-tests / improve-ux.

### Mode: land-lanes

1. Target = remote default (or named product tip). Fetch without mutating worktrees.
2. Inventory every worktree (include `.worktrees/*`): path, branch, upstream, ahead/behind, dirty, ignored-important, stash, sequencer.
3. Classify: clean committed, dirty-only, already reachable, patch-equivalent, divergent, blocked. Use patch-ID + history, not subjects alone.
4. Map path and semantic overlap (schema/consumer, API/caller, migration/model).
5. Backup refs for target and every committed source. Preserve dirty/untracked with verified methods.
6. Make each lane reviewable (`organize-commits` when authorized). Prefer landing via open PRs.
7. Integrate one logical lane at a time; mechanical conflicts only when intent is clear; stop on competing logic.
8. No checks per lane. After convergence, run the end check once on the latest main (orchestrator step 3).
9. Prove original commits + preserved artifacts reachable **before** proposing local cleanup. Remote delete still forbidden unless user asks.

## Long run mode

Long run mode is on when the plan has 2 or more waves, or 9 or more parts, or it runs overnight or unattended, or the user asks. Otherwise it is off. Templates and details: [REFERENCE.md](REFERENCE.md#long-run-mode).

- **Plan shows the run files.** Before any agent starts, the plan page (plan-page skill) shows, in order: a first page "Long run mode: on" (or off) with the reason (example: "3 waves, 14 parts"), the SPEC.md draft filled for this task, the report.md draft (Board, empty Run log, first Handoff), each wave brief, then Your call. The owner can flip the mode there. Approve writes the files and active-run.json, then the first wave starts.
- **Run folder.** The execute run folder (execute step 1, item 5) also holds `SPEC.md`, `report.md` (with `## Board`, `## Run log` and `## Handoff`), `briefs/<wave>.md`, `briefs/<part>.md` (only when one part needs more than its wave brief), `findings/` (scan and audit output that parts read) and `scripts/`.
- **SPEC.md is the plan.** It starts with Repo, Run folder and Plan page lines, and holds no status line; the state lives only in the Handoff. It has the run's goal, decided rules, final structure, one worked example, waves and parts (each with its files and a checklist), how every part works, and the end check. Every owner decision goes into the decided rules with its date, not into the Run log. SPEC.md wins over memory and over the chat. A new owner rule during the run becomes a new wave appended to the waves section.
- **Active run pointer.** The orchestrator writes `${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/<repo>/active-run.json` with `title`, `specPath` and `reportPath`. The agent-setup `active-run-reminder` hook reads it on session start, resume, clear, compact and subagent start, and tells every agent to re-read SPEC.md. One active run per repo: if the file exists, resume that run or ask.
- **Every agent brief says:** read SPEC.md and your brief first; re-read SPEC.md after any summary; check your work against your part's checklist in SPEC.md before each commit (the orchestrator ticks it when it merges); reply with the PR link and a short list.
- **Orchestrator loop.** Each finished agent's notice wakes the orchestrator. Review the diff against SPEC.md, send one fix round, fix a miss that is still there, merge, tick the part's checklist in SPEC.md, and add one Run log line per event. Replace the Handoff at each merge, never append to it; it stays at most 4 lines (merged, running, next).
- **Keep lanes full.** Keep max-lanes running while parts with no shared files wait. Start the next part the moment one finishes.
- **Questions do not block.** A question to the owner never blocks work its answer does not touch: ask, then keep reviewing, merging and starting other parts.
- **Scripts for repeats.** A review step the orchestrator repeats becomes a script in `RUN_DIR/scripts/` that prints a short summary, including the end check.
- **Finish.** Run the end check once on the latest main. Failures get one fix PR and a rerun until it passes. Then delete `active-run.json` so the hook goes quiet, remove the worktrees and keep the branches.

## Verification

### execute

```text
mode: execute
repo: <path>
default: <branch> @ <sha>

host: A|B|C
lanes:
  - N | task | issue | worktree | branch | pr | confidence | merge | end check
skills_reused: organize-commits, finish-and-push, run-local-and-check[, …]
residual: <blocked / deferred / overlaps>
report: <RUN_DIR>/report.md
```

Done only when each started lane has issue + worktree + branch + PR (or honest block), no default-branch product commits, no remote deletes, merges only when authorized and signed off back to back, and the end check passes on latest main (or the block is reported). **“Agents ran” is not done.**

### setup-lanes

Per lane: path, branch, issue URL, host/cmux, `LANE-BRIEF.md`, PR URL, head SHA; no default commits; no remote deletes; leftover unassigned tasks listed.

### land-lanes

Matrix of every worktree disposition, backups, merge order, conflicts, end check result, reachability proof, cleanup authorization (local vs remote separate).

“Everything landed” = reachability + byte preservation — not empty `git status` alone.  
“Agents fired” = issue + branch + PR per lane — not directories alone.
