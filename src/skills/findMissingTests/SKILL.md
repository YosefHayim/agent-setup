---
name: find-missing-tests
description: Use when you want to find which tests each feature is missing and add them. Helper agents check every test type (unit, mocks, integration, e2e), write a report per feature, then add the missing tests test-first. Say "find missing tests", "test gaps", or "add tests to this feature". To merge them across many features, use ship-missing-tests.
type: flow
---

# Find missing tests

**Orchestrator.** Discover product features → fan out **sub-agents** to scan **every test layer** → publish a **per-feature missing summary** → (unless `scan-only`) **TDD-fill** gaps → **run** the repo’s unit/e2e commands.

Slash: **`/find-missing-tests`**, optional scope (repo, feature list, surface).

**Not** framework-locked. Discover Vitest/Jest/pytest/Go/Cargo, MSW/nock/fixtures, Playwright/Cypress/Maestro/Detox from the repo. Prefer existing patterns over new harnesses.

## Reuse first (mandatory)

Load sibling `SKILL.md` files; do not reimplement them.

| Concern | Skill |
|---------|--------|
| Parallel lanes / worktrees / cmux | `run-tasks-in-parallel` **setup-lanes** (one lane per feature domain when filling) |
| Commits | `organize-commits` |
| Push / PR / handoff | `finish-and-push` when user wants ship (default: **no merge**) |
| Single visible browser proof | `run-local-and-check` only if user asks headed interactive QA beyond suite |
| One product feature to main | `ship-one-feature` (different job) |
| Full campaign: parallel lanes + PR + merge to main | **`ship-missing-tests`** (loads this skill for scan/fill rules) |
| Over-engineering scan + lean with parity prove | `simplify-repo-with-tests` (different job; may call this skill for business test gaps only) |
| Multi-feature cleanup (not tests) | `clean-repo-by-feature` |

This skill owns: layer taxonomy, scan briefs, gap matrix, TDD fill order, default **headless** e2e policy, done receipt, and the **run report** (`report.md` in its run folder).

## Run report (mandatory)

Never write run records into the repository: no `docs/` folder, no report at the **repository root**. Each run gets its own folder outside the repo with one `report.md`, so parallel runs never overwrite each other.

| Section in `$REPORT` | Holds |
|------|------|
| `## Features` | Feature inventory |
| `## Report` | Gap report |

1. **New run:** start a run folder, then write only `$REPORT`:

   ```bash
   SKILL="find-missing-tests"
   COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
   REPO_ROOT=$(dirname "$COMMON_GIT_DIR")
   REPO=$(basename "$REPO_ROOT")
   RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/$SKILL"
   RUN_DIR="$RUNS/$(date +%Y-%m-%d-%H%M)"
   [ -e "$RUN_DIR" ] && RUN_DIR="$RUN_DIR-$$"
   mkdir -p "$RUN_DIR"
   REPORT="$RUN_DIR/report.md"
   ```

2. **Resume:** use the run path the user gives, else the newest folder (`ls -1 "$RUNS" | tail -n 1`); do **not** start a new run. Update `report.md` in place in that folder.
3. Full convention: [references/agent-artifacts.md](references/agent-artifacts.md).

## Layers (scan all that exist)

Framework-agnostic **capability** layers — mark N/A if the product has no such surface:

| Layer id | What counts as coverage | Typical evidence (examples only) |
|----------|-------------------------|----------------------------------|
| `backend-unit` | Domain/use-case/store/controller pure tests | `*.test.ts` next to server domain, `go test`, `pytest` |
| `client-unit` | UI/state/hooks/view-model unit tests | vitest/jest colocated under features |
| `contract` | Shared Zod/OpenAPI/schema tests | `shared/**/*.test.*` |
| `mocks` | HTTP/API doubles for client or server | **MSW** handlers, nock, msw/node, fixture servers, recorded cassettes |
| `integration` | Multi-module in-process without full UI | supertest, effect test, worker miniflare tests |
| `e2e-web` | Real browser journey | Playwright, Cypress, Puppeteer |
| `e2e-native` | Real device/simulator journey | Maestro, Detox, XCUITest wrappers |
| `e2e-cli` | Real CLI binary journey | packaged CLI smoke |

A gap is **missing** when the feature’s real behavior has no test that would **fail if that behavior were deleted** (happy path **and** important edges: auth fail, empty, validation, idempotency, permission deny, timeout/retry when code has them).

Edge cases to look for in every feature: empty, one, many, slow or failed network, no permission, double submit, Hebrew right-to-left text. Name each one the feature meets and check a test covers it.

Write tests the way `~/.claude/rules/stack-choices.md` says: one `describe` per exported function, sentence `test()` names inside it, and arrange, act and assert blocks split by blank lines. Assert the values that matter; no snapshots.

## Invocation

```text
/find-missing-tests
/find-missing-tests MYPR-App
/find-missing-tests scan-only
/find-missing-tests fill outreach conversation
/find-missing-tests headed
/find-missing-tests surface=web
/find-missing-tests surface=native
/find-missing-tests surface=all
```

| Flag / phrase | Meaning |
|---------------|---------|
| (default) | Full: scan → summary → TDD fill → run tests |
| `scan-only` | Stop after per-feature gap summary (no write) |
| `fill` / default after scan | Implement missing tests via TDD |
| `surface=web` | E2E focus web only (still scan all unit/mock layers) |
| `surface=native` | E2E focus native only |
| `surface=all` | All e2e surfaces the repo has (default when running e2e) |
| **headless (DEFAULT)** | E2E runners headless / CI mode — **do not require user to say headless** |
| `headed` / `visible` / `ui` | Non-headless / headed / Playwright UI only when user says so |
| `no-cmux` | In-process subagents only |
| `ship` / `open-pr` | After green, use `finish-and-push` to open PR (**still no merge** unless user says merge) |

If the user does **not** say headed/visible/ui → **headless**.

## Safety

- Read-only for **scan** phase. No product code changes until fill phase (or user approved matrix if they asked to review first — default full pipeline does not wait unless `scan-only` or they said “report first”).
- Never print `.env` secrets, real tokens, or production customer data in fixtures. Prefer repo e2e seed accounts and documented test data scripts.
- Do not hit production write APIs for “proof.” Use local/sandbox.
- Topic branch for fill work; never commit test spam on default branch.
- Do not delete remote branches. Do not merge unless user explicitly says merge (this skill defaults to **no merge**).
- Cap fan-out: prefer one sub-agent **per feature domain**; batch tiny features; do not spawn unbounded agents.

## Workflow

### 0. Resolve repo

1. Repo root (cwd or path in prompt). Read `AGENTS.md`, `PROJECT.md`/`CONTEXT.md`, the rules in `~/.claude/rules/` (`stack-choices.md` for tests), package scripts, existing e2e folders.
2. Detect commands **from the repo** (do not hardcode Playwright/Maestro):
   - unit: `test`, `test:unit`, workspace tests, language defaults
   - mocks: directories named `msw`, `mocks`, `handlers`, `fixtures` + imports
   - e2e-web / e2e-native / e2e-cli scripts
3. Record headless vs headed flags **supported by those scripts** (e.g. Playwright default headless; `--headed` only when user asked).

### 1. Feature inventory (orchestrator)

Build a feature list from evidence, not vibes:

- `client/src/features/*`, `server/src/<domain>`, packages, routes, documented domains in CONTEXT.md
- Exclude pure primitives/platform unless they own product rules

Write the `## Features` section of `$REPORT` with stable feature ids + path globs.

### 2. Scan phase — sub-agents

For each feature (or batch), spawn a **read-only** sub-agent (host subagent API and/or `run-tasks-in-parallel` brief-only / cmux). Brief:

1. Own only these path globs.
2. Inventory existing tests per **layer** above (paths + what behavior they assert).
3. List **missing** happy paths and edges grounded in **real code** (handlers, use cases, screens) — no invented product.
4. Note mock/MSW: which APIs the feature calls and whether handlers cover success + error shapes.
5. Return structured JSON/markdown only (template in [REFERENCE.md](REFERENCE.md)).

Orchestrator merges into the **`## Report`** section of `$REPORT`:

```markdown
### Feature: <id>
#### Covered
- backend-unit: …
- client-unit: …
- mocks: …
- e2e-web: …
- e2e-native: …
#### Missing (priority)
1. [layer] <behavior> — why it matters — suggested test location matching repo patterns
2. …
#### Commands to run later
- unit: …
- e2e: …
```

Also a **summary table** for the human:

| Feature | backend-unit | client-unit | mocks | integration | e2e-web | e2e-native | Top gaps |
|---------|--------------|-------------|-------|-------------|---------|------------|----------|

**scan-only → stop here** and present the report.

### 3. Fill phase — TDD (default after scan)

Work on a topic branch (`test/<slug>-gaps` or per-feature lanes via **`run-tasks-in-parallel`** when parallelizing).

For each prioritized gap (P0 edges that can ship bugs, then happy paths):

1. **Red** — write a failing test in the **correct layer** using the repo’s existing style (colocated unit, MSW handler + unit, Playwright spec, Maestro flow, etc.).
2. **Green** — minimal product fix **only if** the test exposed a real bug; otherwise make the test pass by completing coverage of already-correct code (fixtures, wiring). Prefer not to drive large product rewrites under this skill; open a product issue if behavior is wrong and out of scope.
3. **Refactor** — only within test helpers/patterns already used nearby.
4. Re-run the **narrow** test command after each gap cluster.

**MSW / mocks:** when the feature depends on HTTP, add or extend handlers for success **and** the error statuses the UI/domain already branches on. Do not mock away the behavior under test in unit tests that should exercise pure domain logic.

**Order:** backend-unit / contract → mocks → client-unit → integration → e2e-web/native (outer layers last).

### 4. Run phase

After fill (or scan-only + user said “just run existing”):

1. **Unit + integration** for touched packages (repo scripts).
2. **E2E** for requested `surface` (default `all` that exist):
   - **Headless by default** — use CI/headless flags; never open headed UI unless user said `headed`/`visible`/`ui`.
   - If native tools/simulators missing, report **skipped** with exact reason; do not claim native green.
3. Optionally full style/typecheck if `AGENTS.md` requires it before handoff.

On failure: fix tests or product within scope; re-run failed command; do not hide flakes — quarantine only with a tracked issue.

### 5. Handoff / ship (optional)

- Default: leave topic branch + `$REPORT` + list of new tests; commit via **`organize-commits`** if user wants commits.
- `open-pr` / `ship`: **`finish-and-push`** (PR, no merge unless they said merge).
- Parallel worktrees + merge campaign: hand off to **`ship-missing-tests`** (do not half-implement lanes here).
- Do not use `ship-one-feature` unless they want full merge+reinstall of a product feature (not a missing-tests campaign).

## Verification

Done only with fresh evidence:

- [ ] Feature inventory written
- [ ] Every feature has a scan summary (or explicit skipped + reason)
- [ ] Layers include **backend-unit** and **mocks/MSW** when those surfaces exist (not e2e-only)
- [ ] If not `scan-only`: TDD red→green applied; new tests would fail if behavior removed
- [ ] Unit commands green for touched areas
- [ ] E2E ran **headless** unless user requested headed; surface respected
- [ ] Native/web skips explained when tooling absent
- [ ] Sibling skills used for worktrees/commits/PR; no private fork of those procedures

```text
repo: <path>
mode: full | scan-only
headless: true | false (user override)
surface: web | native | all
features_scanned: N
report: <RUN_DIR>/report.md
gaps_filled: N
unit: <cmd> → pass|fail
e2e_web: <cmd> → pass|fail|skip
e2e_native: <cmd> → pass|fail|skip
branch: <name|none>
pr: <url|none>
skills_reused: run-tasks-in-parallel?, organize-commits?, finish-and-push?
residual: <open gaps intentionally deferred>
```

A green e2e suite with silent missing backend unit/mocks is **not** success for this skill.
