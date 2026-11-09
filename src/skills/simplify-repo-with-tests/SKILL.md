---
name: simplify-repo-with-tests
description: Use when you want to find over-engineering in the whole repo and prove that a simpler version works the same. Helper agents find it and show before and after, then it simplifies with tests first. Say "find over-engineering" or "fewer files, same behavior". For a small cleanup, use simplify-code.
type: flow
disable-model-invocation: true
---

# Simplify repo with tests — find over-engineering, then prove same behavior

**Orchestrator.** Discover product modules/features → fan out **sub-agents** to find **over-engineering** (files, folders, layers, line smells, ceremony, **and test-slop**) → publish a **per-feature kill list with proofs + before/after** → (unless `scan-only`) **capture parity with TDD** → **apply lean** (less LOC / fewer files / fewer folders) → **run unit + e2e** and confirm behavior is unchanged.

Slash: **`/simplify-repo-with-tests`**, optional scope (repo path, feature list, `scan-only`).

**Not** a second smell encyclopedia. Smell catalogs live in **`simplify-code`** — load them. This skill owns: scan fan-out, proof matrix, parity-first TDD order, apply scope, headless prove policy, test-slop policy, done receipt, run report.

## Run report (mandatory)

Never write run records into the repository: no `docs/` folder, no report at the **repository root**. Each run gets its own folder outside the repo with one `report.md`, so parallel runs never overwrite each other.

| Section in `$REPORT` | Holds |
|------|------|
| `## Features` | Feature inventory |
| `## Report` | Kill list / report |

1. **New run:** start a run folder:

   ```bash
   SKILL="simplify-repo-with-tests"
   COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
   REPO_ROOT=$(dirname "$COMMON_GIT_DIR")
   REPO=$(basename "$REPO_ROOT")
   RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/$SKILL"
   RUN_DIR="$RUNS/$(date +%Y-%m-%d-%H%M)"
   [ -e "$RUN_DIR" ] && RUN_DIR="$RUN_DIR-$$"
   mkdir -p "$RUN_DIR"
   REPORT="$RUN_DIR/report.md"
   ```

2. **Resume:** use the run path the user gives, else the newest folder (`ls -1 "$RUNS" | tail -n 1`); update `report.md` in place (do not start a new run).
3. Shared rules: [references/agent-artifacts.md](references/agent-artifacts.md).

## Skill map (do not invent siblings)

| Job | Skill | This skill’s role |
|-----|--------|-------------------|
| Line / structure / ceremony smell **catalogs** + local kill apply | `simplify-code` | **Load and follow**; never copy catalogs into this folder |
| Readability rename/reorder only | `make-code-readable` | After lean if names still muddy |
| Adopt the personal rules / set the repo's exceptions | `code-style` | Read `~/.claude/rules/`; do **not** rewrite style docs here |
| Audit “does code follow the standard / PROJECT / AGENTS?” | `code-style` (Audit mode); else read those files | Reference only — not this workflow |
| Missing **business** tests before a safe lean | `find-missing-tests` (fill only business gaps) | Call when parity tests are absent |
| Parallel worktrees / cmux | `run-tasks-in-parallel` | setup-lanes when applying multi-feature lean |
| Commits / PR | `organize-commits` / `finish-and-push` | Only if user wants ship; **default no merge** |
| One product feature to main | `ship-one-feature` | Different job |

## The one test (same as simplify-code)

> An abstraction — wrapper, layer, helper, folder, package, **or test** — earns its place only if it has a **second real caller** or names a **genuine domain concept** (or, for tests, asserts a **user/business rule that would break if deleted**). Otherwise delete or inline it.

## The prove test (this skill’s extra)

> A lean change is **valid** only when existing business unit + e2e (or newly added parity tests written **before** the delete) stay green for the same observable behavior and error handling. “Looks simpler” without a red→green parity story is **not** done.

## Invocation

```text
/simplify-repo-with-tests
/simplify-repo-with-tests MYPR-App
/simplify-repo-with-tests scan-only
/simplify-repo-with-tests fill auth
/simplify-repo-with-tests headed
/simplify-repo-with-tests apply-approved   # only after user approved the kill list this session
/simplify-repo-with-tests open-pr
```

| Flag / phrase | Meaning |
|---------------|---------|
| (default) | Scan → report → **wait for approval** on kill list → parity TDD → apply → prove |
| `scan-only` | Stop after the `## Report` section of `$REPORT` (no product code writes) |
| `apply` / `go` / `approved` | User already approved; do not re-ask if report was shown this turn |
| `fill <feature>` | Limit apply/prove to one feature id |
| **headless (DEFAULT)** | E2E headless / CI — **do not require user to say headless** |
| `headed` / `visible` / `ui` | Headed e2e only when user says so |
| `no-cmux` | In-process subagents only |
| `open-pr` / `ship` | After green, `finish-and-push` PR (**no merge** unless they say merge) |

If the user does **not** say headed/visible/ui → **headless**.

## Safety

- **Scan is read-only.** No product deletes until the kill list is approved (default) or user said `apply`/`go`/`approved` this turn.
- Preserve **observable behavior** and **error handling** unless a behavior change was explicitly approved.
- Topic branch for apply work; never lean-ship on default branch.
- Do not delete remote branches. Do not merge unless user says merge.
- Cap fan-out: one sub-agent per feature domain; batch tiny modules.
- Never print secrets from fixtures or `.env`.
- Prefer **smallest deletion** that removes excess — do not invent a new architecture while “simplifying.”

## Workflow

### 0. Resolve repo

1. Repo root (cwd or path). Read `AGENTS.md`, `PROJECT.md`/`CONTEXT.md`, the rules in `~/.claude/rules/`, the `npx knip` output (first-class kill targets), package scripts, e2e folders.
2. **Load `simplify-code`** (and its three reference catalogs). Those are the smell definitions.
3. Detect unit / e2e commands from the repo (same discovery spirit as `find-missing-tests`). Record headless flags.

### 1. Feature / module inventory

Evidence-based ids (routes, `src/features/*`, packages, documented domains). Write the `## Features` section of `$REPORT` with stable ids + path globs.

### 2. Scan phase — sub-agents (read-only)

For each feature (or batch), spawn a **read-only** sub-agent. Brief:

1. Own only these path globs (product **and** colocated tests).
2. Map **what the feature does** (entrypoint → main path → errors) in plain language.
3. Score against **simplify-code** axes: line / structure / ceremony; plus **test-slop** (see [REFERENCE.md](REFERENCE.md)).
4. For each finding: **path**, **proof** (why excess — e.g. single caller, pass-through only, folder with 1 file), **estimated delta** (files removed, rough LOC), **before sketch** + **after sketch**, **risk** (public API, framework layout, missing tests).
5. List **business behaviors that must stay green** (happy + real error paths already in code).
6. Return structured markdown only (template in REFERENCE).

Orchestrator merges into the **`## Report`** section of `$REPORT`:

```markdown
### Feature: <id>
#### Behavior that must remain
- …
#### Kill list (priority)
| pri | path | axis | proof | Δ files | Δ LOC≈ | before→after | risk |
|-----|------|------|-------|---------|--------|--------------|------|
#### Test-slop (delete or rewrite)
| path | why not business | replace with |
#### Parity tests needed first
| layer | behavior | path |
#### Commands
- unit: …
- e2e: …
```

Human summary table:

| Feature | Excess hits | Files killable | LOC≈ | Test-slop | Parity gaps | Top proof |
|---------|-------------|----------------|------|-----------|-------------|-----------|

**scan-only → stop** and present the report. Default full run: **show kill list and ask approval** unless user already said apply/go.

### 3. Parity capture — TDD **before** deletes

On topic branch (`refactor/<slug>-lean` or per-feature lanes via **`run-tasks-in-parallel`**).

For each approved feature cluster:

1. If a business behavior in the kill-list risk set has **no** test that would fail if that behavior were deleted → write it first (**red** if missing product, else green characterization). Prefer repo patterns; if many gaps, load **`find-missing-tests`** for that feature only (business layers only).
2. Do **not** write tests that lock internal wrappers/folder shape you plan to delete.
3. Run the **narrow** unit suite for those tests → green baseline recorded.

### 4. Apply lean (simplify-code apply rules)

1. Follow **`simplify-code` Apply after approval** on the approved kill list only.
2. Prefer: inline pass-throughs → delete single-use helpers → flatten one-export files → collapse layer-first folders → delete ceremony scripts/orphans → remove test-slop last (after product lean so failures point at real contracts).
3. Keep framework-required layout (e.g. Expo Router file routes) even if it looks nested.
4. After each cluster: re-run parity unit tests → must stay green.

### 5. Prove phase

1. **Unit + integration** for touched packages.
2. **E2E** for surfaces the feature touches:
   - **Headless by default** — never open headed UI unless user said `headed`/`visible`/`ui`.
   - Native missing tooling → honest **skip** + reason (do not claim green).
3. On failure: fix the lean (restore needed code) or fix a **wrong** parity test; do not weaken assertions to force green.

### 6. Test-slop cleanup

After product lean is green:

- Delete tests that only asserted deleted internal names/paths with no business meaning.
- Rewrite tests that over-mocked away the domain under test so they assert the real rule.
- Re-run unit (+ e2e if e2e was slop-touched).

### 7. Handoff

- Default: branch + `$REPORT` + before/after summary; commits via **`organize-commits`** if asked.
- `open-pr` / `ship`: **`finish-and-push`** (no merge unless they said merge).
- Optional readability pass: **`make-code-readable`** on remaining names.

## Verification

Done only with fresh evidence:

- [ ] Feature inventory written
- [ ] Every feature scanned (or skipped + reason)
- [ ] Kill list uses **simplify-code** axes (not a private smell list)
- [ ] Each kill has **proof** + **before/after** (not vibes)
- [ ] If not `scan-only`: approval respected; parity tests existed or were added **before** deletes
- [ ] Unit green for touched areas after lean
- [ ] E2E ran **headless** unless headed requested; skips explained
- [ ] Test-slop removed or rewritten; remaining tests serve business rules
- [ ] Net **files and/or LOC down** for approved kills (or explicit “already lean” stop)
- [ ] Sibling skills loaded for catalogs/worktrees/commits; no private fork

```text
repo: <path>
mode: full | scan-only
headless: true | false
features_scanned: N
report: <RUN_DIR>/report.md
kills_applied: N
files_removed: N
loc_delta: ≈ -N
parity_tests_added: N
test_slop_removed: N
unit: <cmd> → pass|fail
e2e_web: <cmd> → pass|fail|skip
e2e_native: <cmd> → pass|fail|skip
branch: <name|none>
pr: <url|none>
skills_reused: simplify-code, run-tasks-in-parallel?, find-missing-tests?, organize-commits?, finish-and-push?
residual: <deferred kills + why>
```

A smaller tree with red e2e is **failure**. A green suite that still carries the same pass-through layers is **not** this skill’s success either.
