---
name: clone-all-repos
description: Use when you want all your GitHub repos on this computer. It clones or updates every repo into your Code folder, can run pnpm install in each one, and reports what changed. Say "clone all my repos", "pull all repos", or "sync my Code folder".
type: flow
disable-model-invocation: true
---

# Clone all repos

Bootstrap or refresh a multi-repo coding workspace (typically `~/Desktop/Code`) from GitHub user and org remotes, with optional bulk package installs.

## Safety

- Confirm destination root, GitHub scopes (user + named orgs), and whether **clone-only** vs **clone + install** is authorized.
- Never overwrite an existing dirty repo. Skip, report, or ask — do not `rm -rf` or force-reset without explicit approval.
- Prefer `gh` authenticated as the current user. Do not embed tokens in commands or logs.
- Respect package-manager identity: if a repo is npm-only (or forbids pnpm), do not force `pnpm i`.
- Do not run post-install servers, deploys, or migrations during bootstrap unless the user asked.

## Workflow

1. Resolve destination (`CODE_ROOT`, default `~/Desktop/Code`) and target remotes (user login + optional orgs). List existing repos under `CODE_ROOT`, including its `private/` and `public/` folders when they exist.
2. Enumerate remote repos with `gh repo list` (user and each org). Build a plan: clone missing, skip present, note renames/forks.
3. Present the plan (counts + sample names). On approval, clone with `gh repo clone <owner/name> <dest>` into `CODE_ROOT/<name>` without installing unless requested. When `CODE_ROOT` holds `private/` and `public/` folders, clone by repo visibility instead: `CODE_ROOT/private/<name>` or `CODE_ROOT/public/<name>`, with client repos in `clients/<name>` and org repos in `<org>/<name>` under that folder.
4. When bulk install is requested: for each cloned/local repo with a lockfile, detect package manager (`pnpm-lock.yaml` → pnpm, `package-lock.json` without pnpm workspace → npm unless user said pnpm-for-all-except-npm-only, `yarn.lock` → yarn). Run install only where allowed; capture failures per repo.
5. Optional pull-all: for each git repo under `CODE_ROOT`, `git fetch --all --prune` and report ahead/behind / dirty / fail.
6. Write a short matrix: repo → action (cloned/skipped/pulled) → install status → notes.

## Verification

Report:

- destination root and auth identity (`gh api user` login);
- repos cloned, skipped (already present), failed;
- install successes/failures by package manager;
- pull/delta summary when requested;
- anything left requiring user secrets or interactive login.

Do not claim “all repos duplicated” if enumeration or clones failed, or “installed” when only clones ran.
