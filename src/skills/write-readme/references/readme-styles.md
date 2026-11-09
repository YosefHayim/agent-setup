# README Style Routing

Use this after repo inspection and before the grill. Pick one dominant README style from evidence, then adapt the section order. Do not merge every section from every style.

## Decision rules

1. If the first success is "install/import and run code," use a library/package or framework style.
2. If the first success is "run a command and see terminal output," use a CLI/developer-tool style.
3. If the first success is "open the UI and complete a product action," use a frontend app or SaaS/product style.
4. If the README mostly routes to a mature docs site, use a docs-forward portal style.
5. In monorepos, root README owns the repo/product overview; package-level READMEs own package install and usage.

## Style matrix

| Style | Evidence | Reader | Section order | First success | Avoid |
|---|---|---|---|---|---|
| Tiny demo | Small repo, no package registry, no production/deploy signals | Developer running it locally | What it is -> Quick start -> Usage/scripts -> Scope | Start local app or run one command | Feature tables, roadmap, architecture deep dive |
| UI/design system | Components, tokens, examples, docs site, Storybook, visual assets | Builder evaluating components | Pitch -> visual proof -> Documentation -> Install or examples -> Theming/customization -> Contributing -> Changelog/security/sponsors if mature | See components or copy one component into an app | Long local dev setup before showing docs or examples |
| Frontend app | Browser app, route pages, screenshots, hosted URL, user workflows | User or contributor trying the product | Live demo/screenshot -> What it does -> Quick start -> App workflows -> Configuration/env -> Contributing/docs -> Scope | Open hosted/local app and complete one visible action | Treating a product app like an npm library |
| Frontend framework/tooling | Build tool, framework, starter, plugin API, packages workspace | Developer choosing tooling | Pitch -> Getting started -> Docs -> Packages/plugins -> Community -> Contributing -> Security/license | Scaffold/run a minimal app or reach official tutorial | Exhaustive API reference in root README |
| CLI/developer tool | `bin`, command docs, installers, shell screenshots, OS packages | Developer installing and trying a command | Pitch -> Screenshot/demo -> Documentation/manual -> Install by OS/package manager -> Quick examples -> Build/test -> Comparison/tradeoffs -> Contributing/security | Install and run the smallest useful command | Burying install steps below contributor setup |
| SaaS/product/self-hosted app | Cloud/self-host paths, Docker/deploy files, auth/billing/integrations, screenshots | User choosing cloud/self-host or contributor | Why/product value -> Capability map -> Cloud quick start -> Self-host/local quick start -> Architecture/stack -> Support/community -> Security/license/contributing | Create workspace, run local stack, or self-host minimal instance | Hiding operational/security responsibility |
| Backend/API framework | Server framework, API examples, routing/middleware, docs site | Developer building an API | Description/philosophy -> Requirements -> Install -> Minimal create-run-check example -> Docs/tutorials -> Examples -> Tests/contributing/security | Create endpoint, run server, hit URL/docs | Marketing before executable API example |
| Library/package | Published package, importable API, types, package docs | Developer integrating the package | What it is -> Install -> Minimal usage -> Core concepts -> Error handling/types -> Docs/API -> Changelog/contributing/license | Install and run 5-15 line example | Full API reference in README when docs exist |
| Docs-heavy portal | Mature external docs, many guides, repo README mainly routes | Evaluator or contributor finding the right doc | What this repo contains -> Start here -> Docs map -> Support -> Contributing -> License/security | Land on the right guide quickly | Duplicating docs site content in README |

## Professional signals by style

- **UI/design system:** include a real screenshot, gallery, or docs link early. Explain install/customization only after the reader knows what the components look like.
- **Frontend app:** prefer a hosted URL or screenshot before local setup when the repo is public and the app is usable.
- **CLI/developer tool:** show command output or a terse example before long platform-specific install notes if the command is easy to install.
- **SaaS/product:** split cloud, local development, and self-hosting. They are different reader paths with different risks.
- **Backend/API:** the minimal endpoint example must include how to run and how to verify it, such as a URL, curl command, or generated docs route.
- **Library/package:** keep the first code sample small enough to copy. Link out for advanced API surface.

## Calibration sources

Use these as evidence of README shape, not as prose to copy:

- GitHub README guidance: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes
- Standard Readme: https://github.com/richardlitt/standard-readme
- UI/design systems: https://github.com/shadcn-ui/ui, https://github.com/mui/material-ui
- CLI/developer tools: https://github.com/cli/cli, https://github.com/BurntSushi/ripgrep
- SaaS/product/self-hosted apps: https://github.com/supabase/supabase, https://github.com/twentyhq/twenty, https://github.com/n8n-io/n8n
- Frontend apps/tooling: https://github.com/excalidraw/excalidraw, https://github.com/vercel/next.js, https://github.com/vitejs/vite
- Backend/API frameworks: https://github.com/fastapi/fastapi, https://github.com/expressjs/express, https://github.com/nestjs/nest
- Library/package: https://github.com/colinhacks/zod

## Common mistakes

- Treating "frontend" as one style. A component library, browser product, and build tool need different README orders.
- Treating "backend" as one style. A deployable API service and an API framework need different first-success paths.
- Writing a product README for a tiny demo.
- Writing a library README for a self-hosted app.
- Putting contributor setup before user/evaluator success.
- Adding a feature matrix because popular READMEs have one. Use one only when comparison helps the reader decide.
