# Code style: new project

<what-to-do>

There is little or no code yet. Decide the stack from what the project is for, then set the repo up to follow `~/.claude/rules/`. Show a short plan first and wait for my approval.

1. Read `PROJECT.md` when it exists. Missing or thin and the purpose is unclear: ask the seven-part checklist in [PROJECT-FORMAT.md](_shared/PROJECT-FORMAT.md) in one `AskUserQuestion`.
2. Read `~/.claude/rules/stack-choices.md`. Pick the stack from the project's purpose, with the reason from each tool's official docs. Never pick a tool because another repo uses it. Ask the language and where it runs (Node server, Workers, browser, native app) in one card with a recommended answer.
3. Show the plan: stack with reasons, folder layout (per `~/.claude/rules/repo-layout.md`), and the list of files to create. Give examples from the official docs of the main framework.
4. After approval, create the repo files, then follow [ADOPT.md](ADOPT.md) from step 1 (package manager, Biome, alias, root docs, hooks). A new repo has nothing to fix, so skip the Fix step.
5. Root docs are optional. Create `CONTEXT.md`, `LANGUAGE.md` or `PROJECT.md` only when they hold something the README and the rules do not, using [CONTEXT-FORMAT.md](_shared/CONTEXT-FORMAT.md), [LANGUAGE-FORMAT.md](_shared/LANGUAGE-FORMAT.md) and [PROJECT-FORMAT.md](_shared/PROJECT-FORMAT.md). A new `LANGUAGE.md` starts with its first real domain terms and an empty `## Swaps` table.

Once the project has real code, the next run uses Adopt.

</what-to-do>
