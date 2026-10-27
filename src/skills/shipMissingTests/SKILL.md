---
name: ship-missing-tests
description: Use when you want missing tests added across many features and merged to main. It backs up main, gives each feature its own agent and branch, writes the tests first, opens PRs, and merges after the checks pass. Say "ship missing tests" or "test gaps all the way to main". To add tests without merging, use find-missing-tests.
type: flow
disable-model-invocation: true
---

# Ship missing tests

**One slash → full campaign.** Scan test gaps (or **resume** an existing report) → **backup main** → **one parallel lane per feature with gaps** (worktree + issue + branch) → each lane **TDD-fills** + **unit + headless e2e** → PR with confidence → **merge** after hard gates → done receipt.

Slash: **`/ship-missing-tests`**.

This skill is the **glue**. Load sibling `SKILL.md` files and follow them. Do not invent a second worktree scheme, gap taxonomy, or ship path.

## Reuse first (mandatory)

| Concern | Load and follow |
|---------|-----------------|
| Gap layers, scan briefs, TDD order, headless e2e policy | **`find-missing-tests`** |
| Backup main + multi-feature parallel fan-out + lane matrix | **`clean-repo-by-feature`** (host mode A/B/C) |
| Worktree / issue / branch / LANE-BRIEF per lane | **`run-tasks-in-parallel` setup-lanes** |
| Commits | **`organize-commits`** |
| Push + open/update PR (pre-merge) | **`finish-and-push`** |
| Per-lane merge gates + confidence rubric (adapt) | **`ship-one-feature`** REFERENCE (confidence, act) — **merge owned here for multi-lane** |
| Single product feature (not a test campaign) | **Stop** → `ship-one-feature` |
| Over-engineering lean | **Stop** → `simplify-repo-with-tests` |

Owns only: campaign modes, lane selection from gap report, merge sequencing, e2e-unblock policy, campaign done receipt, run report.

## Run report (mandatory)

Never write run records into the repository: no `docs/` folder, no report at the **repository root**. Each campaign gets its own run folder outside the repo with one `report.md`.

| What | Where |
|------|------|
| Features + gap report (from find-missing-tests) | `## Features` and `## Report` in `${XDG_STATE_HOME:-~/.local/state}/agent-setup/runs/$REPO/find-missing-tests/<newest>/report.md` |
| Campaign board | `## Ship` in this run's `$REPORT` |

1. **New campaign:** start a run folder:

   ```bash
   SKILL="ship-missing-tests"
   COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
   REPO_ROOT=$(dirname "$COMMON_GIT_DIR")
   REPO=$(basename "$REPO_ROOT")
   RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/$SKILL"
   RUN_DIR="$RUNS/$(date +%Y-%m-%d-%H%M)"
   [ -e "$RUN_DIR" ] && RUN_DIR="$RUN_DIR-$$"
   mkdir -p "$RUN_DIR"
   REPORT="$RUN_DIR/report.md"
   ```

2. **Gap report:** the path the user gives, else the newest find-missing-tests run (after the scan, when this campaign runs one):

   ```bash
   GAP_RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/find-missing-tests"
   GAP_REPORT="$GAP_RUNS/$(ls -1 "$GAP_RUNS" | tail -n 1)/report.md"
   ```

   Write the `GAP_REPORT` path you use at the top of `## Ship`.
3. **Resume:** use the run path the user gives, else the newest folder (`ls -1 "$RUNS" | tail -n 1`); do not start a new run. `## Ship` names its gap report.
4. `LANE-BRIEF.md` stays **inside each worktree**. Lanes share this `RUN_DIR`: put it in every brief. A lane never starts its own run.
5. Shared rules: [references/agent-artifacts.md](references/agent-artifacts.md).

## Invocation

```text
/ship-missing-tests
/ship-missing-tests MYPR-App
/ship-missing-tests resume
/ship-missing-tests residual-only
/ship-missing-tests scan-only
/ship-missing-tests no-merge
/ship-missing-tests wave=1
/ship-missing-tests surface=web
/ship-missing-tests headed
/ship-missing-tests no-cmux
/ship-missing-tests agent=grok
```

| Flag / phrase | Meaning |
|---------------|---------|
| **(default)** | Scan if no fresh report → backup main → parallel lanes for P0 gaps → fill → prove → PR → **merge** each green lane |
| `resume` / `from-report` | Skip scan; use `## Features` + `## Report` from `GAP_REPORT` (the newest find-missing-tests run or a path the user gives). `resume` also continues the newest `## Ship` |
| `residual-only` | Only features listed under residual / still-missing in the report |
| `scan-only` | Only run `find-missing-tests` scan; stop (no lanes) |
| `no-merge` | Open PRs only; human merges |
| `wave=N` / `max-lanes=N` | Cap parallel lanes this run (default: all P0, max **8** unless user raises) |
| `surface=web\|native\|all` | E2E surfaces (default `all` that exist) |
| **headless (DEFAULT)** | Do **not** require user to say headless |
| `headed` / `visible` / `ui` | Headed e2e only when said |
| `no-cmux` | Host subagents / in-process only (`clean-repo-by-feature` host A) |
| `agent=grok\|claude\|codex` | cmux lane CLI when host B |

If the user does **not** say headed/visible/ui → **headless**.

## Safety

- Invoking this skill **authorizes** merge to default **after hard gates** (same spirit as `ship-one-feature`), unless `no-merge`.
- **Never** commit campaign work on the default branch. Product/test commits only on topic branches.
- **Backup main first** before fan-out (mandatory — follow `clean-repo-by-feature` backup recipe). Record backup name + SHA.
- **Never** force-push protected default. **Never** delete remote branches unless user asks.
- **Hard stop per lane** if unit fails. **Hard stop merge** if required e2e fails when the stack is available.
- If e2e tooling/API/sim is **unavailable**: record **honest skip**, still merge **only if** unit + contract gates pass **and** confidence ≤ cap for missing e2e (see REFERENCE). Prefer `no-merge` wave for e2e-blocked residual when user cares about e2e proof first.
- Cap fan-out: default max **8** concurrent lanes; queue the rest as wave 2.
- One lane = one feature domain = one worktree = one issue = one PR. No cross-lane file thrash.
- Never print `.env` secrets or production customer data in fixtures.

## Workflow

### 0. Resolve repo

1. Repo root (cwd or path). Default branch from `origin/HEAD`. Dirty unrelated main → stop or isolate.
2. Read `AGENTS.md`, `PROJECT.md`/`CONTEXT.md`, the code-standard README, package scripts, e2e setup docs.
3. Detect unit / e2e commands via **`find-missing-tests`** discovery rules.
4. Detect earlier runs: newest folder in `$RUNS` → `## Ship`; newest folder in `$GAP_RUNS` → `## Features` / `## Report`; or an open branch from a prior `find-missing-tests` run.

### 1. Gap matrix (scan or resume)

| Situation | Action |
|-----------|--------|
| `scan-only` | Load **`find-missing-tests`** scan-only → stop with report |
| `resume` / report exists and user implies continue / residual | Use report; refresh only if stale vs HEAD (optional quick re-scan of residual ids) |
| No report or default full campaign without resume | Load **`find-missing-tests`** through **scan + summary** (fill happens **in lanes**, not as one mono-branch dump) |

Orchestrator produces a **campaign board** (write the `## Ship` section of `$REPORT`):

| Feature id | P0 gaps | Layers | Priority | Wave | Notes |
|------------|---------|--------|----------|------|-------|

Select lanes: all features with **P0/P1 missing** (or `residual-only` list). Batch tiny features only when paths do not overlap.

Present the board briefly. If user said “just run it” / default full, **do not wait** for approval unless gaps > max-lanes and need wave split — then run wave 1 and list wave 2.

### 2. Freeze base + host mode

1. **Backup main** — `clean-repo-by-feature` Safety (required).
2. Host mode — follow **`clean-repo-by-feature` §1b**:
   - Default if they said “just run it” / `/ship-missing-tests` alone: **A host subagents**
   - If they said cmux / watch: **B**
   - `no-cmux` → **A**
3. Do not start lanes until backup SHA is recorded.

### 3. Fan out lanes

For each selected feature, **`run-tasks-in-parallel` setup-lanes** (via `clean-repo-by-feature` defaults):

| Item | Value |
|------|--------|
| Worktree | `REPO/.worktrees/missing-tests-<slug>/` |
| Branch | `test/<issue>-gap-<slug>` |
| Issue | Title: `missing tests: <feature id>`; body = missing list from report + acceptance “tests would fail if behavior deleted”; label if useful |
| Brief | `LANE-BRIEF.md` with mandate below |
| Host | A / B / C from step 2 |

#### Per-lane mandate (every LANE-BRIEF.md)

```markdown
# Lane: missing tests <feature_id>
You own ONLY these path globs: <globs>
Issue: #<n>
Base backup: <backup branch> @ <sha>
Default branch: <main>
Report source: <GAP_REPORT> `## Report`, section for this feature
RUN_DIR: <RUN_DIR>

## Job
1. Load skill **find-missing-tests** fill rules for YOUR feature only (TDD red→green).
2. Implement missing P0 then P1 gaps: backend-unit, mocks/MSW if adopted, client-unit, then e2e for surface=<…>.
3. Headless e2e unless brief says headed. Do not invent product features.
4. Run narrow unit for touched packages → must pass.
5. Run e2e for this feature’s journeys when stack allows; else document skip reason in PR.
6. organize-commits on this branch only. Never commit on default branch.
7. finish-and-push: push + open PR to default with Fixes #<n>, Summary, Confidence N/10, Test plan.
8. Do NOT merge (orchestrator merges). Do NOT delete remotes.
9. Stay in cmux session if host B after PR open.
```

Orchestrator may also **promote** an existing mono-branch (`test/find-missing-tests-p0-units`) as **wave 0**: one PR + merge first if it already holds filled work and is clean — then residual features get parallel lanes. Prefer not to re-do already-green clusters.

### 4. Parallel fill (sub-agents)

- Spawn one agent per lane (host A or cmux B).
- Poll PR / check status; do not busy-loop sleep without progress reads.
- On lane failure: fix in that worktree or open follow-up issue; do not block other lanes unless shared contract conflict.

### 5. Prove + PR gates (per lane)

Before merge eligibility:

1. **Unit** green for lane packages (repo scripts).
2. **E2E** headless for `surface` when available:
   - green → full merge eligibility
   - skip (no API/sim) → merge only with **confidence cap** and explicit PR note (REFERENCE); or hold if user said e2e-required
3. **Confidence** (1–10) on PR — same honesty as `ship-one-feature`. **&lt; 6 → do not merge** that lane.
4. **CI** as `finish-and-push` **Hosted CI** says (PR checks if public, local gate if private) — red blocks merge.

### 6. Merge sequence (orchestrator; authorized by default)

Unless `no-merge`:

1. Order merges: **shared/contract** first, then independent features, then UI/e2e-heavy.
2. After each merge: `git fetch`; rebase/update remaining open lane PRs if needed (`run-tasks-in-parallel` land hygiene — no silent main rewrite).
3. Merge:

   ```bash
   gh pr merge <n> --merge   # or repo default squash/rebase
   ```

4. Confirm default branch SHA advances. Leave remote feature branches unless user asks delete.
5. Never merge a red PR.

### 7. Wave 2+

If max-lanes truncated the board: after wave 1 merges (or PRs open under `no-merge`), start next wave with the same backup lineage (new backup tip optional if main moved).

### 8. Done receipt

```text
repo: <path>
mode: full | resume | residual-only | scan-only | no-merge
headless: true | false
backup: <branch> @ <sha>
report: <GAP_REPORT>
campaign: <RUN_DIR>/report.md
waves: N
lanes:
  - feature | issue | worktree | branch | pr | unit | e2e | confidence | merge
default: <branch> @ <sha after>
skills_reused: find-missing-tests, clean-repo-by-feature, run-tasks-in-parallel, organize-commits, finish-and-push
residual: <still open gaps / deferred waves>
e2e_blockers: <API/sim notes if any>
```

## Verification

Campaign **done** only when:

- [ ] Backup of default recorded before fan-out
- [ ] Gap matrix from scan or resume exists
- [ ] Each started lane has issue + worktree + branch + PR (or explicit failed-with-reason)
- [ ] No product/test commits on default by agents
- [ ] Unit green (or lane failed honestly)
- [ ] E2E headless when run; skips explained
- [ ] Merges completed for eligible lanes **or** `no-merge` with open PRs
- [ ] Default branch only moved via PR merges
- [ ] Sibling skills loaded — no private fork of worktrees/TDD/ship steps

“Agents ran” is not done. **Merged (or review-ready PRs under no-merge) coverage on an undamaged main with a restore point** is done.
