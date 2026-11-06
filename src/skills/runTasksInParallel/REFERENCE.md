# run-tasks-in-parallel — reference

## Invocation examples

```text
/run-tasks-in-parallel
1. Add restore-on-launch for packed sessions
2. Fix empty-cart checkout edge case
3. Hebrew RTL on settings screen

/run-tasks-in-parallel merge
1. …
2. …

/run-tasks-in-parallel no-merge headed
1. …

/run-tasks-in-parallel setup-lanes
(task list or freeform features)

/run-tasks-in-parallel land-lanes
```

| Flag / phrase | Meaning |
|---------------|---------|
| (default numbered list) | **execute**, open PRs; merge only if user also said merge/to-main/full ship |
| `merge` / `to main` / `ship all` | Authorize merge, back to back, after the lane reports confidence ≥ 6 |
| `no-merge` | Force PR-only even if merge language appears elsewhere |
| `headed` / `visible` / `ui` | Headed e2e / visible UI QA |
| `no-cmux` | Host A / in-process only |
| `agent=grok\|claude\|codex` | cmux lane CLI |
| `max-lanes=N` | Cap parallel lanes (default 8 running at once; queue rest) |
| `setup-lanes` / `land-lanes` | Force that mode |

## Artifact paths

One folder per run, outside the repo: `${XDG_STATE_HOME:-~/.local/state}/agent-setup/runs/<repo>/run-tasks-in-parallel/<YYYY-MM-DD-HHMM>/`. Start it with the snippet in SKILL.md (execute → Parse tasks, step 5). Parallel SDLC runs and multi-agent hosts never share one board.

| What | Where |
|------|-------|
| Campaign board | `## Board` section of `$RUN_DIR/report.md` |
| Optional state | `## State` section of `$RUN_DIR/report.md` |
| Resume | The run folder the user gives, else the newest: `ls -1 "$RUNS" \| tail -n 1`. No pointer file (the long-run pointer below is the one exception). |
| Lane brief | `<worktree>/LANE-BRIEF.md` only (include `RUN_DIR`) |
| Long-run files | `$RUN_DIR/SPEC.md`, `$RUN_DIR/briefs/`, `$RUN_DIR/scripts/` (see Long run mode) |

Never write campaign boards into the repository: not at the root, not in a `docs/` folder, not in a gitignored folder.

## Board section template

```markdown
## Board

run_dir: <RUN_DIR>
default: main @ <sha>
host: A
merge_authorized: false
updated: <iso>

| # | Task | Slug | Issue | Worktree | Branch | PR | Unit | E2E | QA | Conf | Merge | Notes |
|---|------|------|-------|----------|--------|----|------|-----|----|------|-------|-------|
| 1 | … | … | #n | .worktrees/… | feat/n-… | url | — | — | — | 7 | no | |
```

Unit, E2E and QA stay `—` until the end check fills them.

## LANE-BRIEF.md template (execute)

```markdown
# LANE-BRIEF — run-tasks-in-parallel

Task #: <n>
Issue: <url>
Branch: <type>/<issue>-<slug>
Worktree: <abs-path>
Default branch: <main>
Base SHA: <sha>
RUN_DIR: <RUN_DIR>   # shared run folder; its report.md holds the Board; never start a new run
Path globs (only yours): <globs>
Merge authorized: false | true

## Task
<user text for this line only>

## Acceptance
- [ ] …

## Full SDLC (required)
1. Implement acceptance only in path globs.
2. Unit happy path — add a test that fails if the feature is deleted. Do not run it: no checks while building.
3. E2E/integration happy path — add the smallest durable e2e test. Do not run it.
4. If UI surface: write down the user flow to prove; the orchestrator proves it in the real app after the end check.
5. organize-commits on this branch only. Never commit on default.
6. finish-and-push: push + open PR with Fixes #<n>, Summary, Confidence N/10, test plan. Skip its verify step.
7. No sign-off in the lane. The orchestrator runs gh signoff and merges, back to back with the others.
8. Do NOT merge unless Merge authorized: true and conf ≥ 6.
9. Do NOT delete remotes. Do NOT touch other lanes.

## Lane habits (required)
- Long command: start the command itself in the background and wait for its exit notice. Never watch it with a separate loop that waits only for success: a failed or killed job never prints the success line.
- A wait loop you must write has a deadline, stops on failure too, and ends with a check that fails unless the run passed: `for attempt in $(seq 120); do grep -q -e PASS -e FAIL <log> && break; sleep 5; done; grep -q PASS <log>`.
- On a failure, stop and fix or report it at once. Do not wait for the rest of the run.
- Delete with literal absolute paths you have looked at (`rm -r /abs/path/build`). An `rm` of `$VAR` or a glob shows no clear target and waits for a human to approve it.
- Stop what you started once you no longer need it: simulators, emulators, VMs, Gradle daemons (`./gradlew --stop`), dev servers. They slow every other lane on the machine.

## Style
Follow AGENTS.md and the rules in ~/.claude/rules/ at repo root of this worktree.

## Done for implementer
PR open. Orchestrator owns merge sequencing, sign-off and campaign board.
```

## Confidence (same honesty as ship-one-feature)

| Score | Meaning |
|------:|---------|
| 1–3 | Spec unclear / tests missing — **no merge** |
| 4–5 | Narrow demo / weak e2e — **no merge** without human |
| 6 | Happy-path tests written and acceptance met; min auto-merge |
| 7–8 | Solid coverage, reviewed against acceptance |
| 9–10 | Rare; multi-surface hardened |

**Caps:** no happy-path test for the feature → max 4 + no merge. Thin smoke e2e only → max 7.

## PR body skeleton

```markdown
Fixes #<n>

## Summary
- <user-visible outcome>

## Confidence
**N/10** — <one sentence residual risk>

## Test plan
- [ ] Unit: <what it covers> (run by the end check)
- [ ] E2E: <what it covers> | N/A
- [ ] QA: <flow to prove in the real app> | N/A

## Main safety
- Base: <default> @ <sha>
- Branch: <type>/<issue>-<slug>
- No history rewrite of default
```

## Host modes

| Mode | Behavior |
|------|----------|
| **A** | Background subagents; `cwd` = worktree |
| **B** | `cmux new-workspace --name "lane:<issue>-<slug>" --cwd <worktree> --command "<agent> \"$(cat LANE-BRIEF.md)\"" --focus false` |
| **C** | Print matrix + start commands only; do not claim agents running |

## Test command discovery

1. `AGENTS.md` / README Verification  
2. `package.json`: `test`, `test:unit`, `test:e2e`, `test:integration`, `verify`, `check`  
3. Makefile / just  
4. Language defaults only if no package script  

Happy path = primary success scenario. At least one unit and one e2e assertion should fail if the feature is removed. The end check runs them, never a lane.

## When Actions cannot start jobs

No act and no Docker for CI. For a PR that changes `.github/**`, `actionlint` is the check and the next nightly or main run is the proof. Where Actions cannot start jobs, say the run did not start and name the local check as the proof. Run `run-ci-locally` only when the user asks.

## Reinstall / smoke (optional full ship)

After merges to default when user asked reinstall/smoke:

```bash
pnpm build && pnpm link --global   # or package-specific
<binary> --version
<primary smoke command>
```

## Long run mode

Use it when the job spans several waves or many hours, or must survive memory summaries. Start from the execute run folder (SKILL.md, Parse tasks, step 5). The orchestrator writes the files below before any agent starts.

### Run folder

```text
RUN_DIR/
  SPEC.md              the plan; wins over memory and over the chat
  report.md            ## Board, ## Run log, ## Handoff
  briefs/<wave>.md     one brief per wave, shared by its parts
  scripts/             review and check scripts that print short summaries
```

### SPEC.md skeleton

```markdown
# <Run title>

## 1. What this run does
<goal in 2 to 4 lines>

## 2. Decided rules
- <rule decided by the owner or the orchestrator, one line each>

## 3. Final structure
<folders, modules and names the result must have>

## 4. Worked example
<one real case, from start to finish, showing the rules applied>

## 5. Waves and parts
Each part: its own issue, branch, worktree and one PR that says `Fixes #<n>`. At most 8 agents at once.

### Wave 0
- **0a. <part name>.** Files: `<path>`, `<path>`.
  - [ ] <checkable step>
  - [ ] <checkable step>

### Wave 1
- **1a. <part name>.** Files: `<path>`. Waits for 0a (shares files).
  - [ ] <checkable step>

## 6. How every part works
- Do the work, commit, push, open the PR, and reply with the PR link and a short list of what changed.
- No checks while building: no test, lint, typecheck, build or CI run. The end check covers the work.
- Bans: never push to main, never delete branches, no attribution in commits or PRs, no emojis, never write to /tmp, never read `.env` files, never get around a hook.
- <run-specific bans>

## 7. End check (orchestrator, once, after the last part)
In a fresh worktree of the latest main:
1. <the repo's check command> passes.
2. <proof in the real app or flow, one line per flow>

Every failure is fixed in one PR from a fresh worktree, then the check runs again until it passes. Then the worktrees are removed and the branches kept.
```

Rule: a new owner rule during the run becomes a new wave appended to section 5. Edit no earlier wave to hide the change.

### active-run.json

Path: `${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/<repo>/active-run.json`. The agent-setup `active-run-reminder` hook reads it. One active run per repo: if the file already exists, resume that run or ask the owner.

```json
{
  "title": "Checkout cleanup",
  "specPath": "/Users/<user>/.local/state/agent-setup/runs/<repo>/run-tasks-in-parallel/2026-11-06-1400/SPEC.md",
  "reportPath": "/Users/<user>/.local/state/agent-setup/runs/<repo>/run-tasks-in-parallel/2026-11-06-1400/report.md"
}
```

### Text every agent brief carries

```text
Read SPEC.md and this brief first. Re-read SPEC.md after any context summary.
Tick your part's checklist lines in SPEC.md before each commit.
When done, reply with the PR link and a short list of what changed.
```

### Report: Run log and Handoff

One line per merge in `## Run log`:

```text
- 2026-11-06 14:10 part 2a merged (#412); 2b running.
```

`## Handoff` holds 3 to 4 lines, rewritten after every merge, so a fresh session can resume from it alone:

```markdown
## Handoff

- State (2026-11-06): waves 0 and 1 merged; wave 2 running: parts 2a and 2b.
- Next: part 3 after 2a (shares files); part 4 when a slot frees.
- Open outside this run: none.
```

### Orchestrator loop

1. A finished agent's notice wakes the orchestrator. No timer or polling loop is needed.
2. Review the diff against SPEC.md and the part's checklist.
3. Send one fix round through SendMessage. Fix a miss that is still there yourself.
4. Merge (execute orchestrator step 2), add one Run log line, and update the Handoff state line.
5. Start the next part with no shared files. Keep max-lanes running while the backlog holds such parts.
6. A question to the owner goes out and does not block parts its answer does not touch.

### Finish

1. Run the end check once on the latest main (SPEC.md section 7).
2. Failures get one fix PR, then a rerun until it passes.
3. Delete `active-run.json` so the hook goes quiet.
4. Remove the worktrees and keep the branches.

## Anti-triggers

| Ask | Skill |
|-----|--------|
| One feature merge+reinstall polish only | `ship-one-feature` (or this skill with **one** task + merge) |
| Only commit/push/PR, no multi-lane | `finish-and-push` |
| Whole-repo cleanup matrix | `clean-repo-by-feature` |
| Test coverage campaign | `ship-missing-tests` |
| Live production URL | `deploy-and-check` |
