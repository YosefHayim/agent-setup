# Code style: new project

<what-to-do>

There is little or no code yet. Decide the stack from what the project is for, then adopt code-standard. Show a short plan first and wait for my approval.

1. Read `PROJECT.md`. Missing or thin: ask the seven-part checklist in [PROJECT-FORMAT.md](_shared/PROJECT-FORMAT.md) in one `AskUserQuestion`.
2. Read the "Stack by purpose" section of `code-standard`'s README (read the README at `node_modules/code-standard/README.md` after install, or on its GitHub page before). Pick the stack from the project's purpose, with the reason from each tool's official docs. Never pick a tool because another repo uses it. Ask the language and where it runs (Node server, Workers, browser, native app) in one card with a recommended answer.
3. Show the plan: stack with reasons, folder layout, and the list of files to create. Give examples from the official docs of the main framework.
4. After approval, create the repo files, then follow [ADOPT.md](ADOPT.md) from step 1 (install, Biome, Ruff, alias, AGENTS.md, LANGUAGE.md, gate, score). A new repo starts with a clean score, so `code-standard fix` is usually not needed.
5. Create `CONTEXT.md` and `LANGUAGE.md` from [CONTEXT-FORMAT.md](_shared/CONTEXT-FORMAT.md) and [LANGUAGE-FORMAT.md](_shared/LANGUAGE-FORMAT.md). `LANGUAGE.md` starts with its first real domain terms and an empty `## Swaps` table.

Once the project has real code, the next run uses Adopt.

</what-to-do>
