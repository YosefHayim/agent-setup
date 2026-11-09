# Restructure repo — reference

## Contents

- Official docs: starting pages per framework
- Dependency checks: commands per question
- Scout models: how to find the host's current models and run a read-only scout

## Official docs

Starting pages only. Open the version that matches the installed one, and follow links from there.

| Stack | Structure | Best practices and style |
|---|---|---|
| Expo | [Router core concepts](https://docs.expo.dev/router/basics/core-concepts/), [`src` directory](https://docs.expo.dev/router/reference/src-directory/), [Monorepos](https://docs.expo.dev/guides/monorepos/) | [Environment variables](https://docs.expo.dev/guides/environment-variables/), [Tools and `expo-doctor`](https://docs.expo.dev/develop/tools/) |
| React | [Thinking in React](https://react.dev/learn/thinking-in-react) | [You might not need an effect](https://react.dev/learn/you-might-not-need-an-effect) |
| React Native | | [Networking](https://reactnative.dev/docs/network) |
| Vite | [Guide](https://vite.dev/guide/) | |
| Next.js | [Project structure](https://nextjs.org/docs/app/getting-started/project-structure) | |
| Cloudflare Workers | [Monorepo builds](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) | [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [TypeScript and `wrangler types`](https://developers.cloudflare.com/workers/languages/typescript/) |
| Express | [Routing](https://expressjs.com/en/guide/routing.html) | [Error handling](https://expressjs.com/en/guide/error-handling.html), [Security](https://expressjs.com/en/advanced/best-practice-security.html), [Performance](https://expressjs.com/en/advanced/best-practice-performance.html) |
| Hono | | [Best practices](https://hono.dev/docs/guides/best-practices) |
| Node.js | | [Development vs production](https://nodejs.org/en/learn/getting-started/nodejs-the-difference-between-development-and-production) |
| TypeScript | [Modules](https://www.typescriptlang.org/docs/handbook/modules/theory.html) | [tsconfig reference](https://www.typescriptlang.org/tsconfig/) |
| Workspaces | [pnpm](https://pnpm.io/workspaces), [npm](https://docs.npmjs.com/cli/using-npm/workspaces) | |
| Existing Turborepo | [Structuring a repository](https://turborepo.com/docs/crafting-your-repository/structuring-a-repository) | |
| Import order | | [Biome organize imports](https://biomejs.dev/assist/actions/organize-imports/), [ESLint `sort-imports`](https://eslint.org/docs/latest/rules/sort-imports) |
| Unused code | [knip](https://knip.dev/) | [Handling knip issues](https://knip.dev/guides/handling-issues) |

## Dependency checks

| Question | Command |
|---|---|
| Unused deps, files, and exports | `npx knip` |
| Why is this dep installed? | `pnpm why <dep>` or `npm explain <dep>` |
| Duplicate versions | `pnpm why <dep>` or `npm ls <dep>` |
| Expo version mismatches | `npx expo install --check`, then `npx expo-doctor` |
| Outdated | `pnpm outdated` or `npm outdated` (report majors only; never upgrade one without asking) |

Knip can report false positives, such as a file loaded by config or a dynamic import. Read each finding before it goes on a question card. For another ecosystem, find its official tool and cite it.

## Scout models

Never assume a model name; read what the host offers in this session.

| Host | Where the current models are | How to run a scout |
|---|---|---|
| Claude Code | The `model` values the subagent tool accepts in this session, and the [Subagents](https://code.claude.com/docs/en/sub-agents) and [Model configuration](https://code.claude.com/docs/en/model-config) pages | Pass the picked `model` when spawning each scout. The built-in Explore agent runs on the session model. |
| Codex | `model` in `~/.codex/config.toml`, any `~/.codex/agents/*.toml`, and the faster and stronger models the [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) page recommends today | After the user agrees, add the scout file below, then ask for the `scout` agent by name. |
| Other hosts | The host's model list and subagent docs | Follow the host's subagent docs. |

Offer the user, recommended first: the fastest, cheapest model the host offers (tool runs and listing); a mid model (reads code and doc pages more carefully, costs more); the session model (most careful, costs most). The main agent stays on the session model.

Codex scout file, with the picked model:

```toml
name = "scout"
description = "Read-only scout for restructure-repo. Reports findings with evidence; never edits or decides."
model = "<picked scout model>"
model_reasoning_effort = "low"
sandbox_mode = "read-only"
developer_instructions = """
Stay read-only.
Return only the table the parent asks for, with file:line and evidence on every row.
Do not propose fixes.
"""
```
