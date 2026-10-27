# Code style: adopt code-standard

<what-to-do>

Make the repo follow `code-standard`, step by step, on a feature branch. Show a short plan first and wait for my approval. Nothing is written before that.

Fire every ready question in **one** `AskUserQuestion` (the host question card), recommended option first, marked `(Recommended)`. If the host has no question tool, use one numbered list in a single message. A second card is only for questions that could not exist before the first answers.

My taste is the source of truth. Where the repo's own rules differ from code-standard, ask once whether the rule is a real exception or old habit.

## Before the plan

1. Detect the language and runtime from the manifest (`package.json`, `pyproject.toml`, `wrangler.jsonc`, `expo` in `package.json`). Report "Detected: **X** via `Y`" and confirm.
2. Check the tree is clean (`git status --short`). Create the branch `chore/adopt-code-standard`.
3. Make the run folder (`$RUN_DIR`, see [SKILL.md](SKILL.md)). Not installed yet, so use `pnpm dlx code-standard@<latest>` here: `pnpm dlx code-standard@<latest> check --html-output "$RUN_DIR/before" --json-output "$RUN_DIR/check-before.json"` and keep the health line. This is the score before. Never write run files into the repo.
4. List what exists: `biome.json`, `ruff.toml`, `CODE-STYLE.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, other root `*.md` files, `tsconfig.json` files, the CI files, the package manager lock file.
5. Show the plan: one line per step below, marked create, change, delete or skip for this repo.

## Steps after approval

Commit after each step with a short message.

1. **Install.** `pnpm add -D --save-exact code-standard @biomejs/biome@<version>`. In a pnpm workspace add `-w` (pnpm refuses to add to the workspace root without it). The version is the exact Biome version in `node_modules/code-standard/package.json`; the check reports a mismatch. If the repo is not on pnpm, ask before switching (`pnpm import` turns the old lock file into `pnpm-lock.yaml`; then delete the old lock file).
2. **Biome.** Root `biome.json` has `"extends": ["code-standard/biome"]` and the `$schema` of the pinned version. Keep only settings that are about this repo (ignored folders). Drop formatter options the standard already sets.
3. **Ruff** (only with `.py` files). Root `ruff.toml` with `extend = "node_modules/code-standard/rules/ruff.toml"`.
4. **The `@/` alias**, so `code-standard fix` can turn `../` imports into `@/` (it only rewrites when `compilerOptions.paths` maps `@/*` to one folder). The fixer reads the nearest `tsconfig.json` above each file and only counts `paths` written in that file itself (not inherited through `extends`, and not from `references`). So put `"paths": { "@/*": ["./src/*"] }` (the app's source folder) in that `tsconfig.json`. When the app uses a solution-style `tsconfig.json` with `references`, also keep `paths` in the shared base config that the referenced configs extend, so `tsc` resolves it. Then add what the tool needs, read from that tool's official docs: Next.js reads tsconfig paths itself; Vite needs `resolve.alias` or a tsconfig paths plugin; Vitest follows the Vite config only when there is no `vitest.config.ts` (a separate one needs its own `resolve.alias`); plain Node scripts need a `package.json` `imports` map or stay relative. When an app uses project references, put `paths` in the tsconfig that includes the source. Prove it with the app's typecheck, tests and build.
5. **Agent files.** Rules in `CODE-STYLE.md` that differ from code-standard go into `AGENTS.md` under `## Exceptions to code-standard` (only when there are any). Drop rules code-standard already has. Delete `CODE-STYLE.md`. Merge `CLAUDE.md`, `GEMINI.md`, `.cursorrules` and similar into `AGENTS.md` and delete them. Add the line `Code standard: read node_modules/code-standard/README.md before you write code.` to `AGENTS.md`.
6. **Other root docs.** Allowed: `AGENTS.md`, `README.md` (plus `README.<lang>.md`), `LANGUAGE.md`, `CONTEXT.md`, `PROJECT.md`, and legal files. Fold `CHANGELOG.md`, `CONTRIBUTING.md`, `TECH.md` and similar into those or remove them. Ask once, as one card for the whole set. Missing `PROJECT.md`, `CONTEXT.md` or `LANGUAGE.md`: create them from [PROJECT-FORMAT.md](_shared/PROJECT-FORMAT.md), [CONTEXT-FORMAT.md](_shared/CONTEXT-FORMAT.md) and [LANGUAGE-FORMAT.md](_shared/LANGUAGE-FORMAT.md). A `docs/` folder is folded into those files too.
7. **Swaps.** Read `nameWords` from `check-before.json`: every word in every declared name, most used first, each with example names. Find things that have several names (for example `user`, `userOwner`, `owner`). Propose swaps, ask me, and write the approved ones to `LANGUAGE.md` under `## Swaps` as a table with the header `| Avoid in code | Use |`. Each row is two different names, and the use name must not contain the avoid name.
8. **Fix.** The tree must be clean, so commit everything above first. Then run `pnpm exec code-standard fix`. It applies only safe fixes, never commits and never removes files: repo checks, Knip unused exports and dependencies, code fixers, file renames with `git mv`, Biome, Ruff when there are `.py` files, then install. Run the repo's own checks (lint, typecheck, test, build). Commit its changes as one commit. Fix runs Biome lint only, so then run `pnpm exec biome format --write .` and commit that as its own commit (the standard's formatter differs from most repos' old one); run the repo's checks again. Fix exit codes: 0 clean, 1 findings remain, 2 refused to start.
9. **Remaining findings.** Fix needs a judgment call for the rest. Grep the `findings.md` path that the command printed, by rule or by file, and fix them in small commits. Never paste the HTML or the full findings into the conversation.
10. **Gate.** Add a script `"check-standard": "code-standard check --repo ."` to `package.json` and run it in the repo's verify step. For CI follow the repo's CI rule: public repos run it on every PR, private repos on main only. Run it before push in `.husky/pre-push` when the repo has husky.
11. **Score.** Run `pnpm exec code-standard check --html-output "$RUN_DIR/after"` again. Show the health line before and after and the `report` link it prints.

## Honest limits

- Knip needs `node_modules`: run `pnpm install` before the check, or unused code is not counted.
- Ruff runs through `uvx`; without uv the Python files are not checked.
- Generated or vendored files: mark them in `.gitattributes` with `linguist-generated` or `linguist-vendored` instead of ignoring them in code.
- A name that is a real exception (a framework file name) goes in `## Exceptions to code-standard`, not in a silent ignore.

Hand big cleanup to `restructure-repo` (folders, names, docs) or `simplify-code` (code). Re-running is safe: it only does what is still missing.

</what-to-do>
