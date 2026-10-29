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
| `merge` / `to main` / `ship all` | Authorize merge after hard gates |
| `no-merge` | Force PR-only even if merge language appears elsewhere |
| `headed` / `visible` / `ui` | Headed e2e / visible UI QA |
| `no-cmux` | Host A / in-process only |
| `agent=grok\|claude\|codex` | cmux lane CLI |
| `max-lanes=N` | Cap parallel lanes (default soft 8; queue rest) |
| `setup-lanes` / `land-lanes` | Force that mode |

## Artifact paths

One folder per run, outside the repo: `${XDG_STATE_HOME:-~/.local/state}/agent-setup/runs/<repo>/run-tasks-in-parallel/<YYYY-MM-DD-HHMM>/`. Start it with the snippet in SKILL.md (execute → Parse tasks, step 5). Parallel SDLC runs and multi-agent hosts never share one board.

| What | Where |
|------|-------|
| Campaign board | `## Board` section of `$RUN_DIR/report.md` |
| Optional state | `## State` section of `$RUN_DIR/report.md` |
| Resume | The run folder the user gives, else the newest: `ls -1 "$RUNS" \| tail -n 1`. No pointer file. |
| Lane brief | `<worktree>/LANE-BRIEF.md` only (include `RUN_DIR`) |

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
| 1 | … | … | #n | .worktrees/… | feat/n-… | url | pass | pass | pass | 7 | no | |
```

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
2. Unit happy path — must fail if feature deleted — green.
3. E2E/integration happy path — headless unless brief says headed — green or honest skip.
4. If UI surface: run run-local-and-check checks; record evidence.
5. organize-commits on this branch only. Never commit on default.
6. finish-and-push: push + open PR with Fixes #<n>, Summary, Confidence N/10, test plan.
7. Sign-off as finish-and-push Local sign-off says: `pnpm check`, then `gh signoff` — a failing check blocks merge; fix and rerun.
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
PR open with gates evidence. Orchestrator owns merge sequencing and campaign board.
```

## Confidence (same honesty as ship-one-feature)

| Score | Meaning |
|------:|---------|
| 1–3 | Spec unclear / tests missing — **no merge** |
| 4–5 | Narrow demo / weak e2e — **no merge** without human |
| 6 | Happy-path unit + e2e green; min auto-merge |
| 7–8 | Solid coverage + CI green |
| 9–10 | Rare; multi-surface hardened |

**Caps:** unit without e2e (or reverse) → max 4 + block merge when stack exists. Thin smoke e2e only → max 7.

## PR body skeleton

```markdown
Fixes #<n>

## Summary
- <user-visible outcome>

## Confidence
**N/10** — <one sentence residual risk>

## Test plan
- [x] Unit: `<cmd>` → pass
- [x] E2E: `<cmd>` → pass | skip:<why>
- [x] QA: run-local-and-check → pass | N/A
- [ ] CI: `pnpm check` (turbo) → pass, signoff <sha>

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
2. `package.json`: `test`, `test:unit`, `test:e2e`, `test:integration`, `verify`  
3. Makefile / just  
4. Language defaults only if no package script  

Happy path = primary success scenario. At least one unit and one e2e assertion should fail if the feature is removed.

## When Actions cannot start jobs

No act and no Docker for CI. For a PR that changes `.github/**`, `actionlint` is the check and the next nightly or main run is the proof. In a client repo the local gate is the proof; say the run did not start. Run `run-ci-locally` only when the user asks.

## Reinstall / smoke (optional full ship)

After merges to default when user asked reinstall/smoke:

```bash
pnpm build && pnpm link --global   # or package-specific
<binary> --version
<primary smoke command>
```

## Anti-triggers

| Ask | Skill |
|-----|--------|
| One feature merge+reinstall polish only | `ship-one-feature` (or this skill with **one** task + merge) |
| Only commit/push/PR, no multi-lane | `finish-and-push` |
| Whole-repo cleanup matrix | `clean-repo-by-feature` |
| Test coverage campaign | `ship-missing-tests` |
| Live production URL | `deploy-and-check` |
