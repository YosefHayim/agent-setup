# Run reports

Skills never write their own run records into a repository: no `docs/` folder, no reports at the root, no gitignored scratch folders. Each run gets one folder in the user's state directory, outside every repo.

## Where

```text
${XDG_STATE_HOME:-~/.local/state}/agent-setup/runs/
  <repo>/                      # main repository folder name, the same for every worktree; "global" for runs not tied to one repo
    <skill>/                   # e.g. run-tasks-in-parallel, improve-ux
      2026-10-04-1430/         # one folder per run, local time YYYY-MM-DD-HHMM
        report.md              # the whole run, as sections
        mocks/ | results.json  # assets, only when the run produces them
```

## Start a run

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

## Rules

| Rule | Detail |
| --- | --- |
| New run | Always a new folder. Never write into an older run. |
| Resume | The path the user gives, else the newest folder: `ls -1 "$RUNS" \| tail -n 1`. There is no pointer file. |
| One file | Everything the run records goes in `report.md` as `##` sections (board, state, plan, findings, audit). A separate file only for an asset that is not Markdown: images, mocks, JSON results. |
| Lanes | Parallel lanes share the orchestrator's `RUN_DIR`; put it in every lane brief. A lane never starts its own run. |
| Keep | Do not delete older runs unless the user asks. |
| Chat | The final chat answer is a short summary and ends with the `report.md` path. |

## Never

- No `docs/` folder in the repository: not for runs, decisions, learning notes or agent config.
- No reports, boards or audits at the repository root or in gitignored folders.
- Decisions go in the PR description. Agent config (issue tracker, triage labels, domain notes) goes in `AGENTS.md` sections.

## Skill to report sections

| Skill | Sections in `report.md` | Assets |
| --- | --- | --- |
| run-tasks-in-parallel | Board, State | none |
| find-missing-tests | Features, Report | none |
| ship-missing-tests | Ship (reads the newest find-missing-tests `report.md`) | none |
| simplify-repo-with-tests | Features, Report | none |
| code-style | Findings | none |
| clean-repo-by-feature | Matrix, State, Audit, Health | planpage JSON |
| restructure-repo | Plan (checkbox lines), Report | none |
| improve-ux | State, Matrix, Audit, Taste | `mocks/` |
| benchmark-agents | Report | `results.json` |
| find-repeated-prompts (repo `global`) | Report | the script's output files |
