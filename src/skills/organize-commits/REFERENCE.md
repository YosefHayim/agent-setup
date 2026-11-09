# Organize commits — reference

## Classification

| Diff intent | Commit type | Boundary rule |
| --- | --- | --- |
| New user-visible behavior or exported surface | `feat` | Keep its tests with the feature |
| Correct existing behavior | `fix` | State the defect, not “fix tests” |
| Same behavior, clearer internals | `refactor` | Separate from functional changes |
| Rename or move | `refactor(reorg)` or `chore(reorg)` | Keep moves free of behavior changes |
| Intentional deletion | `chore(remove)` | Name what disappeared and why |
| Documentation only | `docs` | Include generated README changes with their source |
| Test infrastructure only | `test` | Do not split feature tests from their feature |
| Dependency or tooling change | `build` or `chore` | Include the lockfile when owned by the change |
| Workflow configuration | `ci` | Keep unrelated source edits out |

Prefer reorganization before behavior changes when later commits depend on moved paths. Otherwise order commits by dependency.

## Consolidation inventory

For every worktree or candidate branch record:

- absolute path, branch, HEAD, upstream, ahead/behind counts;
- staged, unstaged, untracked, ignored-but-important, stash, and sequencer state;
- merge-base with the integration branch;
- commits not reachable from the target;
- patch-ID duplicates and path or semantic overlap with other candidates.

Create explicit backup refs such as `backup/consolidate-YYYYMMDD-<branch>` before merging. A patch file can supplement a backup ref for dirty work, but it is not equivalent to preserving modes, symlinks, untracked files, submodules, or an in-progress conflict.

## Conflict decisions

| Situation | Action |
| --- | --- |
| Formatting or import order only | Resolve mechanically, then run the formatter |
| One side intentionally removed obsolete code | Preserve the newer product intent when evidence is clear |
| Both sides changed logic | Stop and show the competing intents |
| Lockfile conflicts | Regenerate with the repository package manager |
| Duplicate commit with different SHA | Confirm by patch-ID before skipping |

Never use blanket `ours` or `theirs` conflict strategies.

## Push proof

Before push, confirm authorization, clean or explained status, fresh verification, outgoing commit range, remote relation, and secret scan. After push, compare the local HEAD to the remote ref and report both SHAs. Hosted checks are a separate proof surface; monitor them when “ship” includes CI completion.
