---
name: ship-one-feature
description: Use when you want one feature or one GitHub issue done all the way — branch, code, tests, a PR with a confidence score, CI, merge, and reinstall. Say "ship this feature", "implement this issue fully", or "feature to main". For many tasks, use run-tasks-in-parallel.
type: flow
---

# Ship one feature

**Orchestrator only.** One invocation → one feature **or** one existing issue landed on the default branch with proof.

Slash: **`/ship-one-feature`**, then either freeform feature text **or** an existing issue (`#2`, full URL, `Fixes #2`).

**Done** means: issue linked, topic branch/worktree, happy-path **unit** + **e2e** green, PR with short **Summary** + **Confidence 1–10**, **CI** green as `finish-and-push` **Hosted CI** says, **merged** to default, product **reinstalled/proven**, done receipt. “PR open” alone is **not** done for this skill.

## Reuse first (mandatory)

This skill **must not** reinvent sibling workflows. Before any step, **load the sibling `SKILL.md` and follow it** for that concern. Only implement glue those skills do not own (test hard-gates, confidence score, CI, merge, reinstall, done receipt).

| Concern | Load and follow |
|---------|-----------------|
| Single-lane issue + worktree + branch + cmux/brief + PR skeleton | `run-tasks-in-parallel` **setup-lanes** (exactly **one** lane) |
| Atomic commits / history shape | `organize-commits` |
| Verify, push, open/update PR, handoff hygiene (pre-merge) | `finish-and-push` |
| Multi-feature parallel cleanup | **Stop** — hand off to `clean-repo-by-feature` (not this skill) |
| Multi-feature **missing tests** campaign to main | **Stop** — hand off to `ship-missing-tests` |
| Live production deploy URL | `deploy-and-check` after ship if user asks |
| Browser-only local proof | `run-local-and-check` when the product is a web UI |
| “Which skill?” mid-flight | `which-skill` |
| Patch this skill later | `improve-skill` |

If a sibling skill already defines a command, branch naming, safety rule, or verify step: **use that definition**. Do not fork a second house style inside this file. Recommended practices = **repo docs** (`AGENTS.md` and the code-standard rules) + **sibling skills**, not improvisation.

## Entry modes (equal first-class)

| Mode | User says | Issue step | Everything after |
|------|-----------|------------|------------------|
| **A — New feature** | Feature description only | Create issue (via setup-lanes / `gh issue create`) with acceptance criteria | Same pipeline |
| **B — Existing issue** | `#N`, issue URL, or “implement issue N” | **Do not** create a duplicate. `gh issue view N`; acceptance = issue body + comments | Same pipeline |

Mode B is not a shortcut that skips worktrees, tests, CI, or merge gates. It only skips issue creation.

```text
/ship-one-feature add restore-on-launch for packed sessions
/ship-one-feature #2
/ship-one-feature https://github.com/org/repo/issues/2
/ship-one-feature Fixes #2 — also document restore flags
```

Optional freeform flags:

| Flag | Meaning |
|------|---------|
| (default) | Full pipeline including merge + reinstall |
| `no-merge` | Stop after green PR + CI |
| `no-reinstall` | Merge ok; skip global reinstall |
| `no-cmux` | No cmux; implement in this session’s worktree |
| `agent=grok\|claude\|codex` | Lane CLI when cmux is used |

## Safety

- Invoking this skill **authorizes** merge to default + product reinstall **after** hard gates. It does **not** authorize force-push of protected refs, remote branch deletion, secret exposure, or unrelated deploys.
- Never commit product work on the default branch (same as `finish-and-push` / `run-tasks-in-parallel`).
- **Hard stop** if unit or e2e happy paths are missing/failing — no “test later.”
- **Hard stop** if CI is red. If no CI can run (no hosted run and no `act`), report and **do not merge** without an explicit override this turn.
- Never delete remote branches unless the user separately asks.
- Own only the feature worktree; foreign dirty trees are user-owned.
- Confidence must be honest (see [REFERENCE.md](REFERENCE.md)). Cap rules there apply.
- Prefer cmux when available (per `run-tasks-in-parallel` / `clean-repo-by-feature` host B); else in-process and say so.

## Workflow

### 0. Resolve repo + mode

1. Git root, remote, default branch from `origin/HEAD`. Unrelated dirty main → stop or isolate (sibling safety).
2. Read `AGENTS.md`, the code-standard README (`node_modules/code-standard/README.md`), package verify/test scripts, `.github/workflows/*`.
3. Detect product install surface (npm/pnpm `bin`, agent-setup, cargo, source-only).
4. Classify **Mode A** vs **Mode B** from the user text. If both a description and `#N` appear, **Mode B** wins for the issue id; treat extra text as scope notes on that issue.

### 1. Issue

- **Mode B:** `gh issue view <n> --json title,body,url,labels,state`. Refuse closed issues unless the user insists. Acceptance criteria come from the issue (and clarified comments). Record URL.
- **Mode A:** create one issue with title, problem, acceptance, out-of-scope, label “shipped by ship-one-feature” if useful — prefer the issue-creation path inside **`run-tasks-in-parallel` setup-lanes** rather than ad-hoc divergent fields.

### 2. Lane = `run-tasks-in-parallel` setup-lanes (single lane)

**Load `run-tasks-in-parallel` and run setup-lanes for one task only:**

- one worktree under `.worktrees/`
- one topic branch (`feat|fix|refactor|chore/<issue>-<slug>`)
- `LANE-BRIEF.md` in the worktree
- host: cmux (default when available) or in-process / `no-cmux`

Do **not** invent alternate worktree roots or branch schemes when the sibling already defines them. Brief must include: issue URL, acceptance criteria, unit + e2e happy-path requirement, style doc paths, “no main commits,” “orchestrator owns CI/merge/reinstall.”

### 3. Implement (in the lane only)

Satisfy the issue/feature acceptance criteria using **repo patterns** (reuse internal helpers first; see `reuse-before-build` only when build-vs-buy is ambiguous).

**Gate A — tests (owned by this skill):**

1. **Unit happy path** — add/extend tests for the primary success path; run repo unit command → green.
2. **E2E/integration happy path** — add/extend real suite (CLI integration, Playwright, API, etc.), or smallest durable e2e if none exists → green.
3. Full documented repo gate when present → green.

No PR marked ready / no merge until Gate A passes.

### 4. Commit + push = `organize-commits` then `finish-and-push` (pre-merge)

- Commits: **load `organize-commits`** — intent-split messages, topic branch only.
- Verify + push + open/update PR: **load `finish-and-push`** for status ledger, gates, push confirmation, PR open/update, leftover hygiene.
- Extend the PR body (this skill’s only PR extras) with **Summary**, **Confidence N/10**, and test-plan lines for unit/e2e/CI (template in REFERENCE.md). Always `Fixes #<n>` / `Closes #<n>`.

**Confidence (1–10):** honest belief correctness **and** repo-pattern fidelity. Rubric in REFERENCE.md. Do not default to 9–10. **&lt; 6 → do not merge** (ask human). Partial tests → ≤4 and block merge.

### 5. CI (owned glue)

Follow `finish-and-push` **Hosted CI**: in a public repository watch `gh pr checks`; in a private one the local gate is the pre-merge proof and the default-branch run after step 6 is the hosted one. Use the sibling **run-ci-locally** skill only when hosted CI cannot run (REFERENCE.md). Red → fix on branch, push, re-run.

### 6. Merge (owned glue; authorized by this skill)

Only after Gate A + CI + confidence ≥ 6 (or human override):

```bash
gh pr merge <n> --merge   # or house squash/rebase if that is repo default
```

Confirm default branch SHA. In a private repository, watch the default-branch run for that SHA (`gh run watch <id> --exit-status`); red → fix at once in its own PR. Do not delete remote feature branch unless asked.

### 7. Reinstall / smoke (owned glue)

From updated default: package-appropriate global install or documented prove (REFERENCE.md). Failure → follow-up issue; do not claim shipped.

### 8. Done receipt

Print the verification matrix. Leave cmux open unless the user asked to close it.

## Verification

Shipped only when all are fresh evidence:

- [ ] Mode A created issue **or** Mode B used existing issue (no duplicate)
- [ ] Lane created via **`run-tasks-in-parallel` practices** (worktree + branch + brief)
- [ ] Commits via **`organize-commits`**; pre-merge ship via **`finish-and-push`** (not a private fork of those steps)
- [ ] Unit + e2e happy paths passed
- [ ] PR has Summary + Confidence N/10
- [ ] CI green: PR checks (public) or local gate plus default-branch run (private); act only when hosted CI could not run
- [ ] Merged (unless `no-merge`); default SHA recorded
- [ ] Reinstall/smoke done or N/A
- [ ] No remote deletes unless asked

```text
mode: A-new-feature | B-existing-issue
issue: <url>
branch: <name>
worktree: <path>
host: cmux:<name> | in-process
skills_reused: run-tasks-in-parallel, organize-commits, finish-and-push[, …]
pr: <url>
confidence: N/10 — <reason>
unit: <cmd> → pass
e2e: <cmd> → pass
ci: pr-checks → pass | local-gate + main run <id> → pass | act → pass
merge: <default> @ <sha> | no-merge
reinstall: <cmd> → <smoke>
residual: <none or risks>
```

“Should work” is not shipped. Reimplementing sibling skills instead of loading them is a process failure even if the PR merges.
