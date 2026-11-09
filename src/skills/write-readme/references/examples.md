# Worked Examples

Filled README maps and sample outputs across project shapes. Use these as **calibration**, not templates.

---

## Example 1 — Tiny local todo demo

Single-developer playground, no agents, no deployment.

### Map

```text
Reader:              Developer evaluating or running the app locally.
README style:        Tiny demo.
First success:       Open localhost, add one todo, see it persist on reload.
Builder path:        Extend local CRUD state or swap persistence layer.
Agent path:          None — no agents working here.
Include:             Quick start, usage, storage behavior, scripts.
Exclude:             Auth, cloud sync, deployment, roadmap.
Official links:      Vite docs if README names Vite.
Link out:            None.
Unknown:             —
Recommended artifacts: README.md only.
```

### Sample README.md

````md
# Todo demo

A tiny local todo app built with [Vite](https://vite.dev/). Todos persist to localStorage. No backend.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173 and add a todo.

## Usage

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run test` — run unit tests

## Scope

Single-user, single-device. No accounts, no sync, no server. State lives in localStorage and is cleared with the browser.
````

---

## Example 2 — Active app repo with agents

A web app being actively developed by humans + coding agents.

### Map

```text
Reader:              New contributor or agent picking up work.
README style:        Frontend app.
First success:       Boot the app locally and hit the /health endpoint.
Builder path:        Add a feature module under src/features/.
Agent path:          Read AGENTS.md, run validation commands before finishing.
Include:             What the app does, quick start, scripts, links to deeper docs.
Exclude:             Internal-only ops runbooks; link to wiki.
Official links:      TypeScript, Node.js, pnpm, AGENTS.md convention.
Link out:            AGENTS.md, internal wiki for ops.
Unknown:             —
Recommended artifacts: README.md + AGENTS.md (+ CLAUDE.md as @import of AGENTS.md).
```

### Sample README.md excerpt

````md
# Acme Web

Customer-facing dashboard for Acme accounts. Built with [TypeScript](https://www.typescriptlang.org/) on [Node.js](https://nodejs.org/en).

## Quick start

```bash
pnpm install
pnpm dev
```

Then visit http://localhost:3000.

## Docs

- [AGENTS.md](AGENTS.md) — conventions and validation commands for coding agents
- [Architecture](#architecture) — module layout and data flow, later in this README
- Internal: ops runbooks live in the Acme wiki

## Scope

Frontend only. The API contract is owned by `acme-api`.
````

### Sample AGENTS.md excerpt

````md
# AGENTS.md

## Repo layout

- `src/features/<feature>/` — feature modules; UI, hooks, and tests are co-located
- `src/lib/` — shared utilities
- `src/api/` — generated API client; do not hand-edit

## Validation

- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Test: `pnpm test`

Run all three before declaring a task done.

## Do not

- Hand-edit `src/api/` — it is regenerated from the OpenAPI spec.
- Add new state-management libraries; use the existing stores.
- Introduce backend calls directly from components; go through `src/api/`.
````

### Sample CLAUDE.md

````md
@AGENTS.md

## Claude-specific notes

Prefer the project's existing form primitives in `src/lib/forms/` over generating new field components.
````

---

## Example 3 — Open-source library

A published npm package with public docs.

### Map

```text
Reader:              Developer evaluating the library or integrating it.
README style:        Library/package.
First success:       Install the package and run a 5-line example that returns a result.
Builder path:        Contribute by extending the parser plugins.
Agent path:          Optional; light AGENTS.md if agents are used internally.
Include:             What it is, install, minimal example, link to API reference and docs site.
Exclude:             Full API reference; it lives on the docs site.
Official links:      npm, TypeScript, GitHub Actions if mentioned.
Link out:            Docs site, CHANGELOG.md, CONTRIBUTING.md.
Unknown:             Whether to publish an llms.txt; depends on docs site stability.
Recommended artifacts: README.md (+ AGENTS.md if agents edit the repo, + llms.txt if docs site is stable).
```

### Sample README.md excerpt

````md
# @acme/parser

A streaming parser for Acme log files. Returns typed records for [TypeScript](https://www.typescriptlang.org/) projects.

## Install

```bash
npm install @acme/parser
```

## Example

```ts
import { parse } from "@acme/parser";

for await (const record of parse(stream)) {
  console.log(record.timestamp, record.level);
}
```

## Docs

- Full API reference: https://acme.dev/parser
- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
````

---

## Calibration notes

- A demo should not look like a product. A product should not look like a demo.
- Link external technologies to official docs, then stop. A README with too many links reads like a search page.
- If you find yourself writing a "Features" table for a 200-line repo, stop.
- If the README is more than about 150 lines, ask whether content belongs in a per-package README or `AGENTS.md`.
- The 5-minute quick start is the single most important section. Most other sections are optional.

---

## Example 4 — CLI developer tool

Installable command with a manual and cross-platform packages.

### Map

```text
Reader:              Developer deciding whether to install the tool.
README style:        CLI/developer tool.
First success:       Install the command and run one example that prints useful output.
Builder path:        Build from source, run tests, and read CONTRIBUTING.md.
Agent path:          AGENTS.md if agents edit the repo; otherwise contributor docs only.
Include:             Pitch, screenshot or command output, manual or docs site link, install by OS/package manager, examples, build/test.
Exclude:             Full command reference if a manual or docs site exists.
Official links:      Language/runtime, package managers, shell/manual docs if named.
Link out:            Manual, CONTRIBUTING.md, SECURITY.md, releases.
Unknown:             Which package managers are officially supported.
Recommended artifacts: README.md (+ AGENTS.md if agents edit the repo).
```

### Sample README.md excerpt

````md
# acmegrep

Fast code search for repositories with large generated directories.

## Example

```bash
acmegrep "createUser" src/
```

## Install

- macOS: `brew install acmegrep`
- npm: `npm install -g acmegrep`

## Docs

- Manual: https://example.com/acmegrep/manual
- [CONTRIBUTING.md](CONTRIBUTING.md)
````

---

## Example 5 — Self-hosted SaaS product

Product repo with cloud and self-hosted paths.

### Map

```text
Reader:              Technical evaluator choosing cloud, local development, or self-hosting.
README style:        SaaS/product/self-hosted app.
First success:       Create a cloud workspace or run the local Docker stack and log in.
Builder path:        Extend product modules after local stack is healthy.
Agent path:          AGENTS.md for validation commands, module ownership, and deployment boundaries.
Include:             Why/value, capability map, cloud path, self-host/local path, stack, support, security notes.
Exclude:             Deep deployment runbooks; link out to the docs site.
Official links:      Docker, framework/runtime, database, AGENTS.md convention if mentioned.
Link out:            Docs site, self-host guide, CONTRIBUTING.md, SECURITY.md.
Unknown:             Whether self-hosting is production-supported or personal-use only.
Recommended artifacts: README.md + AGENTS.md (+ llms.txt only if public docs are substantial).
```

### Sample README.md excerpt

````md
# Acme Desk

Open-source support desk for teams that want a cloud workspace or a self-hosted instance.

## Quick start

Use the hosted product at https://example.com, or run locally:

```bash
docker compose up
```

Open http://localhost:3000 and create the first workspace.

## Self-hosting

Self-hosting requires database, email, storage, and secret management. Follow the production guide before exposing an instance publicly.
````

---

## Example 6 — Backend API framework

Framework used to create APIs, with public docs.

### Map

```text
Reader:              Developer evaluating the framework for a backend service.
README style:        Backend/API framework.
First success:       Create a minimal endpoint, run the server, and verify it with curl or generated docs.
Builder path:        Follow tutorials, examples, and contribution docs.
Agent path:          Optional AGENTS.md if agents edit the framework repo.
Include:             Description, requirements, install, minimal endpoint, run/check steps, docs, examples, tests.
Exclude:             Full API reference; keep it on the docs site.
Official links:      Runtime/language, package manager, framework docs.
Link out:            Tutorial, API reference, CONTRIBUTING.md, SECURITY.md.
Unknown:             Supported runtime versions if manifests do not say.
Recommended artifacts: README.md (+ AGENTS.md if agents edit the repo).
```

### Sample README.md excerpt

````md
# Acme API Kit

A small [Node.js](https://nodejs.org/en) framework for building JSON APIs.

## Install

```bash
npm install acme-api-kit
```

## Example

```ts
import { app } from "acme-api-kit";

app.get("/health", () => ({ ok: true }));
app.listen(3000);
```

```bash
curl http://localhost:3000/health
```

## Docs

- Tutorial: https://example.com/docs/tutorial
- API reference: https://example.com/docs/api
````
