---
name: code-style
description: Use when you want a repo to follow the one code standard (the code-standard package). It installs the shared Biome and Ruff config, moves the repo's own exceptions into AGENTS.md, sets the word swaps in LANGUAGE.md, runs the safe fixes, and adds a check to CI. It can also only score a repo. Say "code style", "adopt code-standard", "set up conventions", "score my repo", or "check code against the standard".
---

<what-to-do>

The rules are not written per repo. They live in the npm package `code-standard`. Its README is the rule book: read `node_modules/code-standard/README.md` once it is installed, or on its GitHub page (`YosefHayim/code-standard`) before. A repo only keeps its own exceptions, in `AGENTS.md`.

**How to call the CLI.** Bare `code-standard` is not on PATH. When the repo has it in `devDependencies`, run `pnpm exec code-standard <command>`. When the repo has not adopted it yet, run `pnpm dlx code-standard@<latest> <command>`, with `<latest>` from `pnpm view code-standard version`. The commands below use `pnpm exec code-standard`; swap in `pnpm dlx` before the install step. Package scripts may call `code-standard` bare.

Pick a mode from the request and the repo, then follow only that mode:

| Mode | When | Follow | Writes files? |
| --- | --- | --- | --- |
| **Adopt** (default for a repo with code) | Make the repo follow code-standard | [ADOPT.md](ADOPT.md) | Only after I approve the plan |
| **New project** | Little or no code yet | [NEW-PROJECT.md](NEW-PROJECT.md) | Only after I approve the plan |
| **Audit** | Only score the repo | Below | Never |

Read the chosen file in full before the first question.

### Run folder (Adopt and New project)

Check outputs go in a run folder outside the repo, never in a system temp folder.

```bash
SKILL="code-style"
COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
REPO_ROOT=$(dirname "$COMMON_GIT_DIR")
REPO=$(basename "$REPO_ROOT")
RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/$SKILL"
RUN_DIR="$RUNS/$(date +%Y-%m-%d-%H%M)"
[ -e "$RUN_DIR" ] && RUN_DIR="$RUN_DIR-$$"
mkdir -p "$RUN_DIR"
```

### Mode: Audit (read-only)

1. Run `pnpm exec code-standard check` in the repo root. Outside a terminal it prints three lines: the health line, `report file://.../index.html` and `findings /.../findings.md`. It exits 1 when there are findings; that is not a failure of the run.
2. Show me the health line and the report link.
3. Read the top rules from the `findings.md` path with `grep`. Each finding line is `- <line> <rule>: <message>` under a `## <file> (<count>)` heading. Count findings per rule and show the biggest ones. Never paste the HTML or the whole findings file.
4. Cleanup is not done here. Offer `restructure-repo` for folders, names and docs, and `simplify-code` for code.

Several repos at once: `--repo <path>` (repeat it) or `--repos-folder <path>`. Add `--json-output <file>` when you need the full outcome as JSON.

</what-to-do>
