# PROJECT.md — agent-setup

What an agent reads to understand product intent before changing behavior. The
human-facing introduction lives in `README.md`; runtime boundaries live in
`CONTEXT.md`; approved names live in `LANGUAGE.md`.

## The problem

Coding-agent workflows accumulate the same recurring friction across repositories:
long sessions exhaust their usable context, agents duplicate existing code, local
skills and hooks drift between tools, and every repository rebuilds the same CI and
publishing setup. agent-setup packages one owned set of guardrails, skills, agent
configuration, and workflow templates behind a surgical installer.

## Who it is for

agent-setup serves its owner first and other coding-agent users who deliberately want
this exact set. It is not a plugin marketplace, a hosted agent platform, or a team
service with compatibility guarantees.

## Product promise

A user can install, update, diagnose, configure, and remove what agent-setup installed
without losing unowned bytes. Catalog entries declare what may ship; receipts declare what may be
removed. Installed hooks run without package dependencies and fail open so a guard
cannot block the editor because its own execution failed.

## Goals

- Install or update a selected feature set in global or project scope.
- Restore prior bytes during receipt-authorized uninstallation.
- Warn and wind down long sessions before they exhaust context.
- Detect structurally duplicated TypeScript while edits are being made and in CI.
- Keep agents out of system temporary folders and move ended sessions into the repo they worked in.
- Turn image references into code through a measured screenshot-difference loop.
- Scaffold owned CI and publishing workflows into another repository.
- Keep every supported agent format catalog-driven and evidence-backed.

## Non-goals

- Hosting or discovering third-party extensions.
- Voice and free provider routing: they live in agent-voice and free-model-router.
- Preserving old command forms by default before version 1.0.
- Adding runtime package dependencies to installed TypeScript hooks.
- Guessing unsupported agent lifecycle integrations.
- Hosting workflow execution after templates are copied.
- Building abstractions for hypothetical future consumers.

## Direction

The current product owns installation lifecycle, managed configuration, diagnostics,
feature and agent catalogs, dependency-free hooks, copied skills, status-line presets,
and CI/publishing workflow scaffolding. Near-term work strengthens verified agent
adapters, makes the command surface predictable for both people and automation, and
keeps the authored skills and hooks consistent through one enforceable code-style contract.

Additional template kinds or agent integrations are considered only when an actual
repository or verified tool contract needs them.

## Guiding principles

- One source of truth for each fact, including one generated list of every setting and
  environment variable.
- Business policy separated from mutable mechanisms by reason to change.
- Honest, plain-English domain names, one word per idea, instead of generic placeholders
  or jargon.
- Schema-owned runtime and persisted contracts.
- Catalog-authorized shipping and receipt-authorized removal.
- Dependency-free, fail-open installed hooks.
- Clean breaks over compatibility layers unless migration is explicitly required.
- Tests provide the courage to change structure without preserving accidental design.
