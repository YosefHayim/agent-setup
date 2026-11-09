# Artifact Structures

Reference for what each landing-doc file should contain. Treat these as **shape guides**, not templates to paste verbatim. Adapt to the repo.

---

## README.md

The landing page for humans and builders. Answers six questions, in order:

1. **What is this?** — one or two lines. Concrete, no buzzwords.
2. **Who is it for?** — the reader you confirmed in the grill.
3. **What can I do in 5 minutes?** — copy-pasteable quick start that produces a visible result.
4. **How do I run / use / build with it?** — usage, scripts, common workflows.
5. **What is intentionally out of scope?** — short, honest. Prevents readers from expecting features that don't exist.
6. **Where do deeper docs live?** — links to per-package READMEs, `AGENTS.md`, `ARCHITECTURE.md`, website, official tool docs, etc. Never create a `docs/` folder.

Before writing, choose the dominant README style from [readme-styles.md](readme-styles.md). The six questions stay stable; the section order and emphasis change by project type.

### Suggested skeleton

```md
# <Project name>

<One- or two-line description. What it is, who it's for. Link official pages for named external tools.>

## Quick start

<Copy-paste block that gets to first success in under 5 minutes.>

## Usage

<Common workflows, scripts, flags. Group by user goal, not by feature.>

## Scope

<One short paragraph or bullet list of what is and isn't in scope.>

## Docs

- [AGENTS.md](AGENTS.md) — for coding agents
- [<package>/README.md](<package>/README.md) — per-package detail, when the repo has packages
- <official external links where useful>
```

### Official links

- Link the first README mention of a public external tool, language, framework, runtime, agent surface, or package manager.
- Prefer official docs or home pages over blogs, package mirrors, or search-result pages.
- Do not link every repeated mention. First mention is enough unless a later section needs a more specific official doc.
- Keep local repo docs as relative links.

Useful official docs to verify when relevant:

- GitHub READMEs: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes
- AGENTS.md convention: https://agents.md/
- OpenAI Codex AGENTS.md: https://developers.openai.com/codex/guides/agents-md
- Claude Code overview: https://code.claude.com/docs/en/overview
- Claude memory / CLAUDE.md: https://code.claude.com/docs/en/memory
- Cursor docs: https://cursor.com/docs
- Cursor rules: https://cursor.com/docs/rules
- TypeScript: https://www.typescriptlang.org/
- Node.js: https://nodejs.org/en
- pnpm: https://pnpm.io/
- Biome: https://biomejs.dev/
- Vitest: https://vitest.dev/
- GitHub Actions: https://docs.github.com/en/actions
- npm trusted publishing: https://docs.npmjs.com/trusted-publishers/
- GitHub Copilot repository instructions: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
- llms.txt: https://llmstxt.org/

### Avoid

- Big feature tables for tiny projects.
- "Production-ready", "battle-tested", "blazing-fast" filler.
- Aspirational roadmaps. If it doesn't exist, don't list it.
- Burying agent instructions inside README.
- Restating the obvious. A manifest already tells you it is a Node project; do not write a paragraph about it.

---

## AGENTS.md

The instruction file coding agents read before editing. Short, declarative, and operational.

Answers four questions:

1. **What should agents know before editing?** — repo layout, dominant patterns, conventions that aren't obvious from a single file.
2. **What commands validate work?** — typecheck, lint, test, build. Exact invocations.
3. **What files / modules own what?** — where to put new code, what's where.
4. **What should agents not assume or add?** — banned patterns, dependencies to avoid, scope boundaries.

### Suggested skeleton

```md
# AGENTS.md

Instructions for coding agents working in this repo.

## Repo layout

- `src/` — <what lives here>
- `tests/` — <what lives here>

## Validation commands

- Typecheck: `<cmd>`
- Lint: `<cmd>`
- Test: `<cmd>`
- Build: `<cmd>`

Run all of these before declaring a task done.

## Conventions

- <Naming, file placement, import style, error handling — only the non-obvious ones.>

## Do not

- <Patterns, deps, or shortcuts the agent should avoid, with a one-line reason for each.>
```

### Avoid

- Restating things the agent can read from `package.json` or the file tree.
- Long prose. Use bullets and exact commands.
- Aspirational rules. Only document the current state.

---

## CLAUDE.md

Claude Code's persistent memory file. Two patterns:

**Pattern A — thin pointer** (most repos):

```md
@AGENTS.md

## Claude-specific notes

<Anything Claude needs that isn't applicable to other agents.>
```

**Pattern B — standalone** (Claude is the only agent in use): treat it like `AGENTS.md` and skip the import.

Prefer Pattern A when `AGENTS.md` exists. One source of truth.

---

## .github/copilot-instructions.md

GitHub Copilot's repo-level custom instructions. Same shape as `AGENTS.md` but Copilot-only conventions:

- Coding style and naming.
- Test framework expectations.
- Things Copilot tends to suggest that shouldn't be used here.

Only create this if Copilot is actually used in the repo. Don't add it speculatively.

---

## llms.txt

Public docs index for AI tools. Format ([llmstxt.org](https://llmstxt.org/)):

```md
# <Project name>

> <One-line description.>

## Docs

- [Quick start](https://example.com/docs/quickstart): <one-line summary>
- [API reference](https://example.com/docs/api): <one-line summary>

## Optional

- [Changelog](https://example.com/changelog): <one-line summary>
```

Create only when the project has substantial **public** documentation worth indexing. Skip for internal repos, small libraries, and demos.
