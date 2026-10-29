---
name: finish-and-push
description: Use when the work is done and you want to wrap it up. It runs the checks, commits, pushes to a feature branch, and cleans up. It never pushes to main or deletes remote branches unless you ask. Say "commit and push", "git commit push", "commit push redeploy", "wrap up", or "finish what I asked". To only split commits, use organize-commits.
type: flow
---

# Finish and push

Close the whole delivery loop from the repository's real state. “Done” means the requested outcome is implemented, verified, recorded on a **feature-related branch**, pushed when authorized, and handed off without hidden leftovers.

## Safety

- Read repository instructions and identify the requested scope before changing, staging, or discarding anything.
- Treat existing dirty changes as user-owned until proven otherwise. Never hide them with a broad stash, reset them, or fold them into the task silently.
- **Feature branch by default:** product commits live on a named topic branch (`feat/…`, `fix/…`, `refactor/…`, `chore/…`, or repo convention)—including refinements and improvements to an existing feature. If HEAD is the default branch (`main`/`master`/detected default) with task work, **create or switch to a feature branch first**. Do not commit or push ship work from the default branch unless the user explicitly orders main-only commits.
- **Never delete remote branches** (or remote tags) unless the user explicitly requests it. Local branch/worktree cleanup only with care after reachability is clear—and still not as silent post-ship default.
- Do not lower a quality gate, skip failing checks, expose secrets, rewrite published history, force-push a protected branch, or trigger a deployment unless the request includes it.
- A request to “commit and push” authorizes those actions for the completed scope on the **current feature branch**; it does not authorize releases, merges to default, remote branch deletion, or unrelated cleanup.

## Workflow

1. Inspect repository instructions, branch/upstream, worktrees, status, recent commits, and the complete diff. Build an explicit ledger of requested work, user-owned changes, generated changes, and unresolved items.
2. If on the default branch with product changes (or about to make them), cut a topic branch from an up-to-date default tip before committing. Name it for the job (feature, fix, refactor, chore). Multi-lane parallel work → `run-tasks-in-parallel` **setup-lanes**.
3. Trace the changed behavior through its real entrypoints and tests. Search for placeholders, disabled checks, temporary debug code, stale docs, and unhandled call sites.
4. Run the narrowest relevant checks first. Fix failures within scope, then run the full gate from a fresh command: `pnpm check` (client repos: their documented gate).
5. Exercise the real behavior when the task has a user-visible or integration surface. Use `run-local-and-check` for browser flows and `deploy-and-check` only when deployment is authorized.
6. Review the final diff for correctness, scope, secrets, accidental generated files, and migration or compatibility consequences.
7. Use `organize-commits` when available. Otherwise apply the same essentials: stage by intent, inspect the index, write why/what/impact messages, and re-check status after hooks. Freeform “git commit push” still routes here as the outer loop; do not skip gates for short wording.
8. Push only when requested (including implied by “git commit push” / “push to main” meaning **push the feature branch toward main**, not necessarily commit on main). Confirm the remote ref resolves to the shipped local commit. Open or update a PR to the default branch when that is the user's ship definition; link issues with `Fixes #n` when an issue exists. Then follow **Local sign-off** below: `pnpm check` and `gh signoff` before any merge.
9. Leave a compact handoff: outcome, evidence, branch name, commits (SHAs), remote state, PR URL if any, remaining work, and any action requiring different authority. Completion means SHA + remote + gates — not “files changed.” Do not delete the remote feature branch after push/PR.

If a gate cannot run, say exactly why and downgrade the completion claim. Do not replace current evidence with an older successful run.

## Local sign-off

My Mac is the CI. Own repos (not MYPR-App, Oly-App, vybekiit) never wait for GitHub before a merge. The gate is `pnpm check` (lint, typecheck, test, build through Turborepo).

- Before starting, look at the latest main run: `gh run list --branch main --limit 1`. Red: fix it first in its own PR.
- Work in its own worktree on a feature branch, with an issue and a PR that says `Fixes #<n>`.
- When merging is part of the job, merge one PR at a time:
  1. Rebase on the latest `origin/main`, run `pnpm check` (the pre-push hook runs it again from the cache).
  2. Push, then `gh signoff` puts a green status on the commit.
  3. Fetch. If main moved, go back to 1. If not, `gh pr merge <n> --squash --match-head-commit <sha>`. Never `--delete-branch`.
- A check fails: fix it in the same worktree and run it again until it passes. Never skip or weaken a check.
- After the merge: remove the worktree, keep the branch, report done and ready for the next task.
- GitHub runs the Linux CI after the merge only (public repos on every push to main, private repos nightly). Never wait for it. A red run is fixed at once in its own PR.
- A PR that changes `.github/**` gets one GitHub run on its branch first: `gh workflow run <file> --ref <branch>`. If Actions cannot start jobs (billing, no runner), `actionlint` is the check and the next nightly or main run is the proof. No act, no Docker for CI.
- Client repos (MYPR-App, Oly-App, vybekiit) keep the old flow, and follow the `CI route` line the ci-route mod prints. Public: CI runs on every PR; watch `gh pr checks <n> --watch --fail-fast`. Private: the pre-push hook, tests and build pass locally, ready PRs merge back to back, then watch the one main run with `gh run watch <id> --exit-status`. Actions not starting jobs: the local gate is the proof; say the run did not start.

## Verification

Before claiming completion, confirm all of these from fresh evidence:

- requested behavior and acceptance criteria are covered;
- work landed on a feature-related branch (not default-by-accident);
- narrow checks and `pnpm check` passed (client repos: their documented gate);
- real UI, API, CLI, or integration behavior was exercised where relevant;
- committed files match the reviewed diff and hooks did not leave surprise changes;
- the pushed remote SHA matches local HEAD when push was requested;
- when merged: squash merge with `--match-head-commit`, signoff on that SHA, worktree removed, branch kept;
- no remote branch was deleted unless explicitly requested;
- remaining worktree, worktree-list, stash, and branch state is clean or explicitly explained.

Report the exact commands, outcomes, commit SHAs, branch/remote, PR if any, and any unverified surface. “Should work” is not shipped.
