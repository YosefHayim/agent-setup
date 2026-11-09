---
name: fix-env-config
description: Use when your environment variables and config are a mess. It moves them to one typed and checked place, and finds duplicate reads, hidden defaults, and secrets that leak to the browser. Say "env vars are a mess", "validate config", or "missing env var".
type: flow
---

# Fix env config

Create one fail-loud contract for configuration crossing process, build, deployment, or client boundaries. Consumers receive decoded domain values rather than reading raw environment variables independently.

## Safety

- Read repository and deployment instructions before changing config. Inventory first; do not remove legacy reads until every consumer and environment is accounted for.
- Never print secret values, commit real `.env` files, expose server values to client bundles, or broaden public prefixes to make a build pass.
- Required values fail with actionable key names and remediation, not secret contents. Defaults are allowed only for genuinely optional behavior.
- Preserve build-time, runtime, server, client, test, worker, and deployment-provider boundaries. One contract can have explicit projections; it must not pretend those trust zones are identical.

## Workflow

1. Search all source, scripts, tests, manifests, CI, containers, hosting config, examples, and docs for environment and config reads. Record key, consumer, phase, trust zone, requiredness, default, and current validator.
2. Reconcile aliases and conflicting semantics. Choose canonical domain names and document migrations before editing consumers.
3. Use the repository's schema system as the single decoder. Define required, optional, defaulted, enum, URL, number, boolean, and secret fields inline with their constraints and descriptions.
4. Decode once at the earliest trustworthy boundary. Export a narrow immutable configuration object or explicit server/client projections; do not scatter wrapper getters or repeated parsing.
5. Fail startup or build before partial side effects when required config is absent or invalid. Error messages list problems together when practical and include remediation without values.
6. Migrate consumers by trust zone. Remove old reads only after search proves no live callers, deployment templates, or tests depend on them.
7. Update `.env.example`, setup docs, CI/deployment declarations, and secret-manager key names with safe placeholders and required/optional notes.
8. Add tests for valid decoding, each invalid family, missing required keys, defaults, redacted errors, client projection, and legacy alias behavior when migration is intentionally supported.

## Verification

Prove:

- the before/after inventory covers every raw read and deployment declaration;
- one schema-owned boundary now controls each trust zone;
- missing and invalid required values fail before application side effects;
- error output contains key names but no secret values;
- client artifacts contain only explicitly public configuration;
- repository search finds no unintended legacy reads;
- typecheck, tests, build, and deployment-config validation pass.

Do not call configuration consolidated while consumers still parse raw values independently or production defines keys not represented by the contract.
