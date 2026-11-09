---
name: code-style
description: Use when you want a repo to follow the personal code rules in ~/.claude/rules/ (code-style.md, repo-layout.md, stack-choices.md). It lines up the repo's Biome config, folders, file names, root docs and repo exceptions with those rules, on a branch, after you approve a plan. It can also only review a repo against them. Say "code style", "adopt the rules", "set up conventions", or "check code against my rules".
---

<what-to-do>

The rules are not written per repo. They live in `~/.claude/rules/` and load in every Claude Code session:

- `code-style.md`: names, conditions, functions, constants, types, errors, modules, React, Python.
- `repo-layout.md`: folders, files, root docs, config.
- `stack-choices.md`: default stack by purpose, and tests.

Read the file you need before you judge or change code. A repo keeps only its own exceptions, in `AGENTS.md`, and only when it has any. There is no checker tool and no score. Biome built-in rules are the only hard check.

Pick a mode from the request and the repo, then follow only that mode:

| Mode | When | Follow | Writes files? |
| --- | --- | --- | --- |
| **Adopt** (default for a repo with code) | Make the repo follow the rules | [ADOPT.md](ADOPT.md) | Only after I approve the plan |
| **New project** | Little or no code yet | [NEW-PROJECT.md](NEW-PROJECT.md) | Only after I approve the plan |
| **Review** | Only look, no changes | Below | Never |

Read the chosen file in full before the first question.

### Mode: Review (read-only)

1. Read the three rule files in `~/.claude/rules/`.
2. Check the repo against them with `git ls-files`, `grep` and `pnpm exec biome check .`: folder and file names, root docs, banned name words, nested ifs, `function` declarations, barrel files, `any`.
3. Show the biggest groups of findings, each with two or three example files. Never paste a whole file list.
4. Cleanup is not done here. Offer `restructure-repo` for folders, names and docs, and `simplify-code` for code.

</what-to-do>
