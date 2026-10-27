# Code style: adopt the personal rules

<what-to-do>

Make the repo follow `~/.claude/rules/` (`code-style.md`, `repo-layout.md`, `stack-choices.md`), step by step, on a feature branch. Show a short plan first and wait for my approval. Nothing is written before that.

Fire every ready question in **one** `AskUserQuestion` (the host question card), recommended option first, marked `(Recommended)`. If the host has no question tool, use one numbered list in a single message. A second card is only for questions that could not exist before the first answers.

My taste is the source of truth. Where the repo's own rules differ from `~/.claude/rules/`, ask once whether the rule is a real exception or old habit.

## Before the plan

1. Detect the language and runtime from the manifest (`package.json`, `pyproject.toml`, `wrangler.jsonc`, `expo` in `package.json`). Report "Detected: **X** via `Y`" and confirm.
2. Check the tree is clean (`git status --short`). Create the branch `chore/adopt-code-rules`.
3. Read the three files in `~/.claude/rules/`.
4. List what exists: `biome.json`, `ruff.toml`, `CODE-STYLE.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, other root `*.md` files, `tsconfig.json` files, the CI files, the package manager lock file.
5. Show the plan: one line per step below, marked create, change, delete or skip for this repo.

## Steps after approval

Commit after each step with a short message.

1. **Package manager.** The repo uses pnpm with exact versions (no `^` or `~`). If it is not on pnpm, ask before switching (`pnpm import` turns the old lock file into `pnpm-lock.yaml`; then delete the old lock file).
2. **Biome.** Root `biome.json` uses Biome built-in rules only: no custom lint plugins, no home-made checker tools. Pin `@biomejs/biome` exactly, then run `pnpm exec biome migrate --write` and commit it, and run `pnpm exec biome format --write .` and commit that on its own. Keep only settings that are about this repo (ignored folders).
3. **Ruff** (only with `.py` files). Root `ruff.toml` with PEP 8 naming, as in `code-style.md`.
4. **The `@/` alias**, so cross-folder imports use `@/` and never `../`. Test-only folders: `e2e/` holds end-to-end tests, helpers and fixtures; unit tests sit next to their source as `name.test.ts`. When tests import from `e2e/`, add an `@e2e/*` alias next to `@/*` in the tsconfig and in every vitest config. Put `"paths": { "@/*": ["./src/*"] }` (the app's source folder) where `tsc` reads it for the source: the app's `tsconfig.json`, or with a solution-style `tsconfig.json` (`references`), the referenced config that includes the source or the base config it extends. Then add what the tool needs, read from that tool's official docs: Next.js reads tsconfig paths itself; Vite needs `resolve.alias` or a tsconfig paths plugin; Vitest follows the Vite config only when there is no `vitest.config.ts` (a separate one needs its own `resolve.alias`); plain Node scripts need a `package.json` `imports` map or stay relative. Prove it with the app's typecheck, tests and build.
5. **Agent files.** Rules in `CODE-STYLE.md` that differ from `~/.claude/rules/` go into `AGENTS.md` under `## Exceptions` (only when there are any). Drop rules the personal rules already have. Delete `CODE-STYLE.md`. Merge useful steps from `CLAUDE.md`, `GEMINI.md`, `.cursorrules` and similar into `AGENTS.md` and delete them. `AGENTS.md` holds only steps an agent needs in this repo (commands, release steps, recipes) and never repeats the rules.
6. **Other root docs.** Always fine: `README.md` (plus `README.<lang>.md`) and legal files. `AGENTS.md`, `LANGUAGE.md`, `CONTEXT.md` and `PROJECT.md` are optional: keep or add one only when it holds something the README and the rules do not already say; use [PROJECT-FORMAT.md](_shared/PROJECT-FORMAT.md), [CONTEXT-FORMAT.md](_shared/CONTEXT-FORMAT.md) and [LANGUAGE-FORMAT.md](_shared/LANGUAGE-FORMAT.md) for the shape. Fold `CHANGELOG.md`, `CONTRIBUTING.md`, `TECH.md` and similar into those or remove them. Ask once, as one card for the whole set. A `docs/` folder is folded in too.
7. **Swaps.** Only when the repo keeps a `LANGUAGE.md`. Find things that have several names (for example `user`, `userOwner`, `owner`), propose swaps, ask me, and write the approved ones under `## Swaps` as a table with the header `| Avoid in code | Use |`. Each row is two different names, and the use name must not contain the avoid name.
8. **Fix.** The tree must be clean, so commit everything above first. Then fix the code against `~/.claude/rules/` in small commits, one concern each: file renames with `git mv`, `../` imports to `@/`, banned name words, nested ifs, `function` declarations, barrel files, `any`. Run `pnpm exec biome check --write .` for what Biome fixes. Run the repo's own checks (lint, typecheck, test, build). Renames do not update string paths: fix the paths in build configs (tsup/vite `entry` maps), `package.json` scripts, workflows and docs, and keep public entry keys and `exports` subpaths unchanged. Env reads go only through one config file; tests use `vi.stubEnv` with `unstubEnvs: true` in the vitest config. Split big work into lanes by folder so no two lanes edit the same file.
9. **Gate.** The gate is the repo's verify step with `biome ci .` in it. For CI follow the repo's CI rule: public repos run it on every PR, private repos on main only. Run it before push in `.husky/pre-push` when the repo has husky; hooks only verify and never change files. Never skip hooks. Before the first push, `pnpm exec biome ci .` must be clean.
10. **Before merge.** When the repo's release workflow publishes on merge, check that the release-skip label (for example `no-release`) exists (`gh label list`) and is on the PR.

## Honest limits

- Generated or vendored files: mark them in `.gitattributes` with `linguist-generated` or `linguist-vendored` instead of ignoring them in code.
- A name that is a real exception (a framework file name) goes in `AGENTS.md` under `## Exceptions`, not in a silent ignore.

Hand big cleanup to `restructure-repo` (folders, names, docs) or `simplify-code` (code). Re-running is safe: it only does what is still missing.

</what-to-do>
