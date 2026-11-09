---
name: organize-commits
description: Use when you want your changes split into small, clear commits with good messages. It can also clean up history and merge branches without losing work. It works on a feature branch, not main. Say "organize commits", "organized commits", "split commits", or "clean git history". To also run checks and push, use finish-and-push.
type: flow
---

# Organize commits

Make Git history a debug timeline: one intent per commit, useful messages, and no stranded work. Run only on an explicit commit, push, ship, or consolidation request.

## Safety

- Read repository instructions and inspect status, branch, upstream, recent history, staged/unstaged diffs, untracked files, worktrees, and stashes before staging.
- Preserve user-owned and unrelated changes. Stop if secrets, credentials, unexplained generated files, or ambiguous overlapping intent appear.
- **Feature branch by default:** if HEAD is the default branch and the work is product change (feature, fix, refactor, refinement, chore), **create/switch to a topic branch** before committing unless the user explicitly wants default-branch-only commits.
- Never change Git configuration, rewrite published history, force-push a protected branch, or delete branches, tags, stashes, or worktrees without explicit authorization.
- **Never `git push --delete` / delete remote refs** unless the user explicitly asks. Prefer leaving remotes for handoff and CI.
- Push only when requested. Existing approval remains valid when the user already asked for commit and push in the same task.
- Use merge, not rebase, to consolidate shared work. Create backup refs before integration.

## Workflow

1. Confirm branch: not accidental default-branch product commits. Branch name should reflect intent (`feat/…`, `fix/…`, `refactor/…`, …) when creating one.
2. Classify every changed path by intent: feature, fix, refactor, reorganization, removal, docs, test, build, CI, performance, style, or chore.
3. Group changes so each commit is independently understandable and does not leave the repository knowingly broken. Split mixed files by hunk only when the boundary is real.
4. Present the commit sequence when approval has not already been given. Include subject, intent, files, rationale, verification, and whether push is authorized.
5. Stage explicit paths or hunks. Audit `git diff --cached` before every commit.
6. Use an imperative conventional subject and a body that records motivation, concrete change, and impact:

   ```text
   type(scope): short subject

   Why: <motivation>
   What: <concrete change>
   Impact: <behavior, risk, or none>
   ```

7. Inspect status and the index after each commit because hooks may regenerate or stage files. Keep hook-produced changes with the intent that owns them.
8. Run the repository's fresh verification gate before shipping non-trivial work.
9. Immediately before push, fetch or inspect the remote relationship, confirm no secret entered the outgoing range, and push without force. Do not delete the remote branch afterward.

For classification, split, push, and consolidation examples, read [REFERENCE.md](REFERENCE.md). Multi-worktree fan-out or land → `run-tasks-in-parallel`. Full verify/handoff loop → `finish-and-push`.

## Verification

Report:

- branch name (and that it is not default-by-accident for product work);
- every new commit SHA and subject;
- the fresh verification commands and outcomes;
- local branch, upstream, ahead/behind state, and pushed remote SHA;
- remaining staged, unstaged, untracked, stashed, branch, or worktree state;
- confirmation remote branches were not deleted unless explicitly requested.

Do not call history clean if work remains unexplained, and do not call a push complete until the remote contains the reported commit.
