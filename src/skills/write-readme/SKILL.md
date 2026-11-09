---
name: write-readme
description: Use when you want to write or fix a project README (and llms.txt). It reads the repo first, asks you one question at a time with a suggested answer, then writes the docs. Say "write a README", "fix the README", or "llms.txt". For AGENTS.md and other agent files, use update-agent-docs.
---

# Write README

A good README is not just polished Markdown. Decide **what each artifact owns** and **which artifacts this repo actually needs** before writing.

## Artifact split

| File | Audience | Owns |
|------|----------|------|
| `README.md` | Humans + builders evaluating or running the project | What it is, who it's for, 5-minute success, usage, scope, official links to tools, and links to deeper docs |
| `AGENTS.md` | Coding agents editing the repo | Validation commands, module ownership, repo conventions, what not to assume |
| `CLAUDE.md` | Claude Code specifically | Claude-only memory; usually `@import` AGENTS.md plus Claude-specific notes |
| `.github/copilot-instructions.md` | GitHub Copilot | Copilot-only conventions |
| `llms.txt` | Public AI doc indexers | Curated public docs index; only for projects with substantial public docs |

**Default recommendation:** `README.md` + `AGENTS.md`. Single-file `README.md` only for tiny demos with no agents working on them.

## Process

1. **Inspect the repo** before asking anything discoverable.
2. **Capture official links** for public tools, runtimes, frameworks, languages, agents, and package managers named in the README.
3. **Choose the README style** from repo evidence. Use [references/readme-styles.md](references/readme-styles.md) when the project is UI, CLI, SaaS/product, frontend app/tooling, backend/API, library, or docs-heavy.
4. **Grill the user**, one question at a time, each with a recommended answer and a one-line reason.
5. **Build a README map** and get explicit approval.
6. **Write**, then report what changed.

## Step 1 — Inspect first

Read what is discoverable before asking. Capture:

- Project type: library, app, CLI, web app, mobile, docs site, demo
- Language and primary framework from manifests such as `package.json`, `pyproject.toml`, `Cargo.toml`, or `go.mod`
- Scripts that become "how to run/build/test"
- Existing `README.md`, `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `llms.txt`
- Public vs internal signals: `LICENSE`, registry publishing, deployment configs, private/internal language
- Official docs or home pages for named external tools and technologies
- Approximate size and activity: rough LOC, recent commit cadence

If something is discoverable, **do not ask**. State it and confirm in one line.

## Step 2 — Choose the README style

Pick one dominant structure before asking subjective questions. Use repo evidence, not the user's labels alone:

- UI/design system or component library
- Frontend app
- Frontend framework or tooling
- CLI or developer tool
- SaaS/product or self-hosted app
- Backend/API framework
- Library/package
- Tiny demo
- Docs-heavy portal

Read [references/readme-styles.md](references/readme-styles.md) for the section order, first-success shape, link-out strategy, and anti-patterns for each style.

If the repo mixes styles, choose by the first reader and first success. Example: a monorepo with a hosted app and SDKs can have a product README at the root and package READMEs under `packages/*`.

## Step 3 — Grill, one question at a time

Each question follows this shape:

```text
Q: <one sharp question>
Recommended: <one answer>
Why: <one short reason>
```

Skip any question the inspection already answered. Order:

1. **Reader** — Who opens this README first? developer evaluating, builder integrating, end user, or agent
2. **First success** — What should a reader achieve in 5 minutes?
3. **Builder path** — How does a builder extend, integrate, or contribute? or N/A
4. **Agent path** — Are agents editing this repo? If yes, `AGENTS.md` is in scope.
5. **Scope** — What is intentionally out of scope? No fake roadmap or aspirational features.
6. **Deeper docs** — Where do they live? README sections, per-package READMEs, website, internal wiki, none
7. **Artifacts** — Confirm the final list of files to write.

## Step 4 — Build the README map

Produce this map and get approval before writing:

```text
Reader:
README style:
First success:
Builder path:
Agent path:
Include:
Exclude:
Official links:
Link out:
Unknown:
Recommended artifacts:
```

See [references/examples.md](references/examples.md) for filled maps across project types.

## Step 5 — Write

Follow [references/artifacts.md](references/artifacts.md) for the structure of each file.

When a usable file already exists, **edit, don't replace**. Preserve the user's voice; merge new structure into existing content.

## Hard rules

- **Don't invent.** No fake production status, no aspirational features, no "revolutionary / seamless / robust / blazing-fast" filler.
- **Don't bloat.** A 200-line demo gets a 30-line README. No feature tables for a toy project.
- **Don't bury agent rules.** Agent guidance goes in `AGENTS.md`, not deep inside `README.md`.
- **Don't turn README into architecture docs.** If depth is needed, use a short later README section, a per-package README, or an existing `ARCHITECTURE.md`. Never create a `docs/` folder.
- **Don't guess shape-changing facts.** If you can't tell whether the repo is public, internal, library, or app, ask one question.
- **Don't cite unofficial docs when official docs exist.** First README mention of an external tool, language, framework, runtime, package manager, agent, or platform gets an official hyperlink.
