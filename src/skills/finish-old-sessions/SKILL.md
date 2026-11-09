---
name: finish-old-sessions
description: Use when you want to find and finish work left half done in past agent sessions. It compares each session with the current repos, so nothing is done twice. Say "finish old sessions", "resume unfinished work", or "what did I leave half done".
type: flow
disable-model-invocation: true
---

# Finish old sessions

Recover genuine unfinished outcomes from local agent history, reconcile them with current repositories, and finish them from present truth. A transcript ending mid-task is evidence to inspect, not an instruction to execute blindly.

## Safety

- Use the privacy and coverage rules from `find-repeated-prompts`: read-only stores, user prompts only, redacted reporting, local processing, and explicit unsupported coverage.
- Current repository, remote, issue, PR, deployment, and provider state outrank old plans, checklists, claims, and test output.
- Do not inherit stale permission for deployments, publishing, purchases, external messages, deletion, OAuth, credentials, or destructive cleanup. Require current authorization for consequential actions.
- Coordinate one repository lane at a time. Preserve dirty work, worktrees, stashes, sequencer state, and unclear ownership; never overwrite them to make a session appear resolved.
- Do not invent work from TODOs, brainstorming, rejected proposals, or broad roadmap language. Recover only an explicit requested outcome with concrete remaining acceptance criteria.

## Workflow

1. Discover and inventory every supported local agent store in scope. Produce detected, parsed, skipped, errored, archived, encrypted, and unsupported counts with date range.
2. Extract candidate interrupted tasks from user intent, assistant status, tool outcomes, handoffs, plans, and terminal markers. Retain source agent/session IDs and repository/worktree/branch hints.
3. Deduplicate candidates that refer to the same outcome across agents or retries. Group by repository and requested acceptance criteria, not wording.
4. Reconcile each candidate against current evidence: repository instructions, status, worktrees, stashes, branches, merge-base, commits, remote refs, PR/issues/checks, deployments, and changed requirements.
5. Classify each item as completed elsewhere, superseded, stale/no longer requested, duplicate, genuinely unfinished, externally blocked, or ambiguous. Record evidence for every classification.
6. For each genuine item, restate the bounded outcome and remaining acceptance criteria. Detect conflicting owners and dependency order before editing.
7. Resume from current code rather than replaying old commands. Inspect existing partial implementation, preserve useful work, fix within scope, and run fresh task-specific checks.
8. Apply `finish-and-push` to close each authorized task: full repository gate, real behavior proof where relevant, review, commit/push when currently authorized, remote/check confirmation, and clean or explained state.
9. Maintain a durable progress ledger after every completed item so interruption cannot recreate another unknown partial finish.

If the number or risk of genuine tasks is large, prioritize by dependency and user impact, but continue until each item is either complete or honestly blocked. Do not collapse blocked into complete.

## Verification

The final ledger must include:

- agent/session coverage and sanitized source IDs;
- canonical task, repository/worktree/branch, deduplicated sessions, original outcome, and current classification;
- current-state evidence and remaining acceptance criteria for each genuine item;
- exact files, tests, commits, pushes, PRs, deployments, or artifacts completed now;
- fresh narrow and repository-wide verification results;
- residual blocked items with blocker, required authority or external change, and next exact action;
- zero unexplained active, partial, or ambiguous classifications.

Do not say “all sessions finished” unless every supported candidate has an evidence-backed terminal classification and every genuine in-scope task is complete or explicitly blocked.
