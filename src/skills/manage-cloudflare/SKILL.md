---
name: manage-cloudflare
description: Use when you want to set up or fix Cloudflare — wrangler config, D1 databases, KV, R2, Workers, Pages, and secrets. Say "wrangler config", "D1 migrate", "R2 bucket", or "Cloudflare secrets". To prove a deploy is live, use deploy-and-check.
type: flow
---

# Manage Cloudflare

Operational Cloudflare/Wrangler work: project wiring, D1/KV/R2, env layout, and safe migrations. **Deploy-and-prove** remains the skill for “ship immutable source and prove production serves it.”

## Safety

- Confirm account/target (workers.dev vs custom domain, preview vs production) before mutating remote state.
- Never print secret values, commit `.dev.vars` with real secrets, or broaden public env prefixes to make a build pass.
- Prefer read-only inventory first (`wrangler whoami`, list DBs/buckets, show migrations pending).
- Back up D1 (or export) before destructive migrate/reset when data may exist.
- Do not treat a successful `wrangler deploy` CLI exit alone as product proof — hand live behavioral proof to `deploy-and-check` when the user wants “is it live?”

## Workflow

1. Read repo Cloudflare docs: `wrangler.toml` / `wrangler.jsonc`, `package.json` scripts, existing D1/KV/R2 bindings, and environment names.
2. Inventory remote vs local: login, account, workers/pages projects, D1 databases, KV namespaces, R2 buckets, pending migrations.
3. Plan ops explicitly: create resource, bind, migrate, backup, secret set, multi-env split, or proxy/route change. Call out data risk.
4. Apply the smallest authorized change with official Wrangler/CLI (no house wrapper scripts unless product-specific glue is required).
5. Verify with independent readback: resource exists, binding name matches code, migration applied, secret keys present (not values), routes/DNS as expected.
6. If the user also wants production behavior proof, continue with `deploy-and-check` after ops are stable.

## Verification

Report:

- account/environment and config files touched;
- resources created/updated (IDs/names only);
- migration/backup commands and outcomes;
- bindings now matching application code;
- secrets keys present vs missing (never values);
- residual risks (orphaned resources, dual config, unapplied envs).

Do not claim Cloudflare is “done” while local config and remote resources disagree, or while a deploy was requested but not proven live.
