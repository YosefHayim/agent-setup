---
name: clean-repo-by-feature
description: Use when a project is messy and you want to clean it one feature at a time. It backs up main, gives each feature its own agent and branch, and opens one PR per feature for you to review. Say "messy repo", "clean up the whole project", or "one agent per feature".
type: flow
disable-model-invocation: true
---

# Clean repo by feature

Turn a messy multi-feature repository into **parallel, reviewable remediations** without rewriting history on the default branch.

You are the **orchestrator**. Each sub-agent owns **exactly one** feature (or bounded module). Main stays safe: a **backup ref/branch** is created first; all product work lands on topic branches and **PRs into main** for human review.

Reuse existing skills rather than inventing a second ship path:

| Concern | Skill |
|---------|--------|
| Worktree layout, lane isolation, land later | `run-tasks-in-parallel` (**setup-lanes** / **land-lanes**) |
| Commit / push on a feature branch | `organize-commits` + `finish-and-push` |
| Lean structure / ceremony kill | `simplify-code` (then `make-code-readable` for readability if needed) |
| Missing style SSOT | `code-style` (once, before mass fan-out when absent) |
| UI / local proof | `run-local-and-check` |
| After lanes merge messily | `run-tasks-in-parallel` **land-lanes** only |

## Safety

- **Protect main:** never commit product work on the default branch; never force-push it; never rewrite its published history as part of this skill.
- **Backup main first** (required gate before any fan-out):

  ```bash
  git fetch origin
  DEFAULT=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)
  git branch "backup/${DEFAULT}-$(date -u +%Y%m%dT%H%M%SZ)" "origin/${DEFAULT}"
  # optional remote safety copy when user allows push of backup refs:
  # git push origin "refs/heads/backup/${DEFAULT}-…"
  ```

  Record the backup branch name and SHA in the orchestrator report. Prefer pushing the backup branch when the user wants an off-machine copy; local-only backup is minimum.
- **Never delete remote branches** (including backup or feature branches) unless the user explicitly asks.
- One agent = one feature = one worktree = one branch = one issue = one PR. No cross-lane file ownership without re-planning.
- Do not merge PRs to main unless the user explicitly asks after review.
- Do not deploy, publish, or delete production resources as part of cleanup.
- Respect `AGENTS.md` and the rules in `~/.claude/rules/`; if the repo is far from them (old `CODE-STYLE.md`, no Biome), run `code-style` (Adopt) **once** first rather than N conflicting styles.
- **Never close cmux workspaces/panes** created for lanes unless the user explicitly asks. They are human entry points, not throwaway spawn shells.



## Artifact paths (run isolation)

Campaign boards and reports go in one new run folder outside the repo, never in the repository and never in a fixed path that parallel runs overwrite.

```bash
SKILL="clean-repo-by-feature"
COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
REPO_ROOT=$(dirname "$COMMON_GIT_DIR")
REPO=$(basename "$REPO_ROOT")
RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/$SKILL"
RUN_DIR="$RUNS/$(date +%Y-%m-%d-%H%M)"
[ -e "$RUN_DIR" ] && RUN_DIR="$RUN_DIR-$$"
mkdir -p "$RUN_DIR"
REPORT="$RUN_DIR/report.md"
```

Write the Matrix, State, Audit, and Health sections in `$REPORT`. Save planpage JSON as its own file in `$RUN_DIR`. Resume → use the run folder the user gives, else the newest one: `ls -1 "$RUNS" | tail -n 1` (do not start a new run). Put `RUN_DIR` in every `LANE-BRIEF.md`. Product agent config (issue tracker, triage labels, domain notes) lives in `AGENTS.md` sections.

## Workflow

### 1. Scope the mess (orchestrator only)

1. Confirm repo root, remotes, default branch, dirty state. Stop if the main checkout has unrelated dirty work the user did not authorize folding in.
2. Read `AGENTS.md`, the rules in `~/.claude/rules/`, `PROJECT.md` / `CONTEXT.md` when present.
3. Inventory **features/modules** from evidence (not vibes): app routes, `src/features/*`, packages in a monorepo, documented domains, or a user-provided list. Produce a table: `id | path globs | risk | suggested work (refactor|harden|cleanup|fix|docs)`.
4. Present the table and get approval on **which lanes to open now** (batch size). Huge repos: wave 1 critical paths only.
5. **Ask host mode** (required unless the user already stated a preference in this turn). Do not assume background-only fan-out.

### 1b. Host mode (ask the human)

Present these options clearly; wait for an answer before creating agents:

| Mode | What the human gets | When to pick |
|------|---------------------|--------------|
| **A. Host subagents** (default if they say “just run it”) | Background spawn via the current agent host (`spawn_subagent` / equivalent). Progress comes back to the orchestrator. **No dedicated terminal per lane.** | Fire-and-forget; they only want the review matrix + PRs. |
| **B. cmux terminal per lane** | One named cmux **workspace** (or surface) per feature, `cwd` = that lane’s worktree, agent CLI launched with the lane brief. Human can **watch live**, **jump into any lane terminal**, and **keep chatting / give follow-up tasks** to that same agent. | “I want to see them”, “cmux for each”, “I want to go into the sub-agents”, multipane supervision. |
| **C. Briefs only** | Worktrees + issues + `LANE-BRIEF.md` written; human (or they) starts agents themselves. | They control every launch, or cmux/agent CLI is unavailable. |

If they choose **B**, also ask (short, one pass):

1. **Agent CLI** for the lane terminals: `grok` | `claude` | `codex` | other command they name (default: same family as the orchestrator host when obvious, else ask).
2. **Layout preference** (optional): one **workspace per lane** (recommended — easy tab switch) vs split panes inside one workspace (only when lane count is small, ≤4).
3. **Auto-start agent?** yes (default) = open terminal and run the agent with the brief; no = open terminal at worktree with brief file only, they submit.

If they already said e.g. “cmux terminal for each sub agent”, skip re-asking mode and only fill gaps (CLI / auto-start).

### 2. Freeze a safe base

1. Create the **backup/** branch of `origin/<default>` (see Safety).
2. Ensure working policy: product commits only on topic branches; PRs target default branch.
3. If the repo is far from `~/.claude/rules/` and the user wants consistency across lanes, run `code-style` (Adopt) **once** on the main checkout (or a single docs-only branch) before fan-out so every lane follows one standard.

### 3. Fan out lanes (delegate to run-tasks-in-parallel setup-lanes)

For each approved feature, follow `run-tasks-in-parallel` **setup-lanes** with these defaults:

| Item | Default |
|------|---------|
| Worktree root | `REPO/.worktrees/` |
| Branch | `refactor/<issue>-<slug>` or `fix/…` / `feat/…` by work type |
| Issue | `gh issue create` with acceptance criteria + path globs + out-of-scope |
| Agent brief | **Only** that feature’s paths, backup SHA, default branch name, style doc paths, “no main commits”, “open PR with Fixes #n”, “do not merge”, “do not delete remote” |
| Host | From **§1b** — A host subagent, B cmux terminal, or C brief-only. Never invent a fourth ship path. |

Always write the full mandate (§4) to:

```text
<worktree>/LANE-BRIEF.md
```

so a human can open any lane later, re-paste, or continue work after the first agent turn.

#### Host A — host subagents

- Prefer the host spawn/subagent API with `cwd` = the lane worktree (and worktree isolation when the host supports it).
- Orchestrator remains the only chat surface unless the user later asks to open cmux for a subset of lanes.

#### Host B — cmux terminal per lane

Requires `cmux` on `PATH` and a live cmux socket (`cmux ping` / `cmux identify`). If cmux is missing or the socket is down: report that, fall back to **C** for those lanes, and keep going.

Per approved lane (after worktree + issue + `LANE-BRIEF.md` exist):

```bash
# from orchestrator shell; do not steal focus on every lane
cmux new-workspace \
  --name "lane:<issue>-<slug>" \
  --description "<branch> · Fixes #<issue> · <worktree>" \
  --cwd "<absolute-worktree-path>" \
  --command "<agent-start-command>" \
  --focus false
```

**Agent start command** (pick the CLI they chose; brief must land in the agent session):

| CLI | Suggested `--command` pattern |
|-----|-------------------------------|
| `grok` | `grok "$(cat LANE-BRIEF.md)"` or host-equivalent that starts a session in cwd with the brief as the first user message |
| `claude` | `claude --dangerously-skip-permissions "$(cat LANE-BRIEF.md)"` only if the user already uses that flag; otherwise `claude "$(cat LANE-BRIEF.md)"` |
| `codex` | `codex -- "$(cat LANE-BRIEF.md)"` (or their usual flags, e.g. `--yolo`, only if they use them) |
| other | Exact command the user named; still `cwd` = worktree |

If **auto-start = no**, omit `--command` (or send only `clear` / a no-op) so the terminal opens at the worktree; tell the human the brief path and a one-liner to start the agent.

Optional small-batch split layout (≤4 lanes, only if they asked for panes not tabs):

```bash
cmux new-workspace --name "messy-wave-1" --cwd "<repo-root>" --layout '<json with one terminal surface per lane, each with its own cwd/command>'
```

Prefer **one workspace per lane** when unsure — easier to pin, rename, notify, and re-enter without layout thrash.

Record for each lane: cmux workspace ref/id (and surface if known), name, and that the human may:

- switch to that workspace/tab anytime to **watch** the agent;
- type additional instructions in that terminal to **continue or redirect** the same lane;
- leave it running while reviewing other lanes.

Do **not** treat cmux lanes as fire-and-forget only: poll or re-read PR/branch state when building the matrix, and leave terminals open.

#### Host C — briefs only

- Create worktree + issue + `LANE-BRIEF.md` as usual.
- Print a start matrix (path, branch, issue, brief path, suggested agent command).
- Do not claim agents are running until the human says they started them (or PRs appear).

### 4. Per-agent mandate (paste into every lane brief)

Each sub-agent must:

1. `cd` into its worktree only; never edit other worktrees or the main checkout.
2. Implement the scoped remediation (refactor / harden / clean up / fix) inside its path globs.
3. Follow the rules in `~/.claude/rules/` and repo `AGENTS.md`; use `simplify-code` / `make-code-readable` when the job is lean/readability.
4. Run the repo’s narrow checks for touched areas, then the full documented gate when feasible.
5. Commit with `organize-commits` on its topic branch; close the loop with `finish-and-push` (push branch, not main).
6. Open a PR **into the default branch** with:

   - title that names the feature;
   - body starting with `Fixes #<issue>` or `Closes #<issue>`;
   - **Review summary** (required sections):

     ```markdown
     ## Summary
     What was messy and what changed (3–8 bullets).

     ## Scope
     Paths owned by this lane. Explicit non-goals.

     ## Risk
     What could break; migration notes.

     ## Test plan
     - [ ] commands run + results
     - [ ] manual/UI checks if any

     ## Main safety
     - Base: <default> @ <sha>
     - Backup branch: backup/<default>-…
     - This PR does not modify history of main.
     ```

7. Stop at open PR. Do not merge. Do not delete remote branches.
8. If running inside a **cmux** terminal the human opened for this lane: stay in that session after the PR is open so they can assign follow-up work in the same place; do not exit the agent solely because the first mandate finished unless they asked for a one-shot run.

### 5. Orchestrator review pack (for you)

After lanes report (or when the human asks for status), produce one matrix:

| Feature | Issue | Branch | Worktree | Host (A/B/C) | cmux workspace | PR | Head SHA | Verify | Notes |
|---------|-------|--------|----------|--------------|----------------|----|----------|--------|-------|

Plus:

- backup branch name + SHA;
- chosen host mode + agent CLI;
- default branch still pointing at pre-fan-out tip (or only intentionally advanced if user merged something);
- recommended review order (low-risk first, or dependency order);
- which PRs block others (shared contracts, migrations);
- for mode **B**: how to re-enter a lane (workspace name/ref) and reminder that terminals were left open for watch / follow-up tasks.

If two PRs conflict, do **not** force-resolve on main. Prefer rebasing the later PR onto updated default after earlier merges, or run `run-tasks-in-parallel` **land-lanes** with backups when the user wants a single integration branch—still no silent main rewrite.

### 6. After human review

- Merge only when the user says so (GitHub UI or authorized `gh pr merge`).
- Leave feature and backup remotes unless the user explicitly authorizes deletion.
- Leave cmux lane workspaces unless the user explicitly asks to close them.
- Optional: next wave of features once wave 1 is merged (re-ask host mode only if they change preference).

## Verification

Do not claim the messy repo is “cleaned” until:

- backup of default branch exists and is recorded (and pushed if requested);
- every started lane has issue + topic branch + PR into default with `Fixes`/`Closes` link;
- no product commits were made on the default branch by this run;
- no remote branches were deleted unless explicitly requested;
- each PR body includes Summary / Scope / Risk / Test plan / Main safety;
- orchestrator matrix lists SHA + verify status per lane;
- host mode was **asked** (or explicitly pre-stated) and recorded; for mode **B**, each lane has a cmux workspace ref/name (or a documented fallback to C);
- every lane has `LANE-BRIEF.md` in its worktree;
- handoff states what remains messy and what was deferred.

“Agents ran” is not success. **Reviewable PRs against an undamaged main, with a restore point**, is success. For cmux mode, success also means the human **can still enter each lane terminal** to inspect or continue work unless they asked for one-shot auto-close (default: keep open).
