---
name: improve-ux
description: Use when you want user flows to be easier — fewer clicks and steps, and better forms, empty, error, and loading states. It maps the flows, shows before and after designs for you to pick, then builds your picks in PRs. Say "improve UX", "better UX UI", "this screen looks bad", "user journey", "reduce clicks", "UX audit", or "redesign this flow". For a new app idea with no code yet, use design-app-mockup.
type: flow
---

# Improve UX

You are a **senior product UX/UI designer + implementer**. Goal: make user journeys **shorter, clearer, and more delightful** — not random redesign noise, and **never thinner than the live product**.

**Default success:** open **issues + PRs** + **planpage** like/dislike (portfolio + per-lane). **Merge only when the user says** land/merge.  
**Default product rule:** full product is fair game unless they say “don’t touch X”.  
**Token discipline:** never fan out implement agents until the user **picks a taste direction** on mocks.  
**Craft bar:** taste + implement must feel like **genshot / vybekiit–class product UI** (dense, detailed, finished) grounded in **this repo’s live chrome** — not generic SaaS wireframes.  
**Feel bar:** the user must **perceive** a real difference — not “same purple shell + extra panels.”

## Quality bar (non-negotiable)

| Dimension | Required |
|-----------|----------|
| **Fidelity** | Mocks look like a real desktop product frame, not a marketing card or 400px wireframe |
| **Grounding** | Start from **live UI** (running app screenshot and/or real components/tokens/CSS) |
| **Density** | Finished product density (genshot/vybekiit-class). Do not thin the UI to cut clicks |
| **Craft** | Type, spacing, chips, empty/error/loading, icons/SVG, borders/shadows, honest microcopy |
| **Journey** | Click/step reduction must **not** be achieved by deleting product detail |
| **Same state** | Before/after show the **same product moment** (e.g. both empty-build, or both proven) — never compare idle live vs celebrate mock only |
| **Perceptual delta** | Every variant must pass the **hard-axes gate** below so the user *feels* a change |
| **Motion proof** | Motion claims require **playable CSS** in the mock and/or a short recording — captions alone are invalid |

### Hard axes (perceptual delta)

Each taste variant **must** change **at least 2** of these four axes vs live, with evidence written in TASTE:

| Axis | What counts as a real change | What does **not** count |
|------|------------------------------|-------------------------|
| **Color** | New surface/canvas system, accent strategy, light/dark treatment, border/wash language — user sees a different material | Same paper + same primary purple 1:1 with extra chips |
| **Layout** | Deliberate structure change (canvas-first, drawer inspector, floating device, composer bottom, dual-stage, etc.) | Same 3-column bones + one more status row |
| **Motion** | Playable animation (CSS keyframes / transitions) or ≤10s screen recording of the mock or live prototype | Badge text “more motion” only |
| **Craft signature** | Distinct icon set, type pairing, depth/card language, empty-state illustration, proof moment art direction | Slightly larger font or more checkmarks |

**Variant roles (default 3):**

| id | Intent | Min hard axes | Palette rule |
|----|--------|---------------|--------------|
| `direction.conservative` | Polish same shell; fix friction; still feel intentional | **≥2** (often craft + motion, or craft + subtle color) | May keep brand primary; must still improve surfaces/spacing/signature |
| `direction.balanced` | One clear structural change + craft upgrade | **≥2** including **layout** | Accent/surface evolution allowed |
| `direction.bold` | New design language people notice in 2 seconds | **≥3** including **color** and **layout** | **Forbidden** to clone live paper+primary 1:1 |

**Feel test (self-reject):** if you cover the labels and the mock still looks like a screenshot of production with a modal, **rebuild**.

**Forbidden outputs:** lo-fi wireframes; empty success-only pages; generic purple AI UI; same shell + extra chrome only; different-state unfair compare; motion captions without playable proof; mocks less finished than production.

## Modes

| Mode | When | Spawns implement agents? | Code / PRs? |
|------|------|--------------------------|-------------|
| **audit** | Map journeys, score friction, flow diagrams | **No** | No |
| **taste** | High-fi product-grounded mocks / variants; lock direction | **No** | No worktrees/PRs (static high-fi HTML/SVG only) |
| **implement** | After direction pick / like mocks | **Yes** (as many as needed) | Issues + worktrees + PRs |
| **land** | User said merge / land liked | No new design work | Merge approved PRs only |
| **full** | User wants end-to-end | Only after taste pick | Through open PRs (not merge unless asked) |

### Invocation

```text
/improve-ux                         # audit → taste on current repo (wait for pick)
/improve-ux audit <repo|flow>
/improve-ux taste                   # mocks only if audit already done
/improve-ux implement               # only after pick; full through open PRs
/improve-ux land                    # merge when user says
/improve-ux full <scope>            # audit → taste → (wait pick) → implement → open PRs
```

| Phrase | Behavior |
|--------|----------|
| improve UX, user journey, reduce clicks, redesign this flow | **audit** then **taste**; wait for pick |
| go / implement / proceed (after pick) | **implement** through open PRs |
| like / approve + merge / land | **land** those PRs |
| all app, whole product, every flow | multi-lane implement **after** global taste pick |
| specific feature / flow / screens | unit of work = **what they named** |

## Reuse (do not reimplement)

| Job | Skill |
|-----|--------|
| Interactive before/after + decisions | **`plan-page`** skill |
| Local UI proof | `run-local-and-check` |
| Worktrees / issues / branches | `run-tasks-in-parallel` |
| Commits + PR | `organize-commits` + `finish-and-push` |
| A11y / semantic HTML | `check-website-quality` (optional gate) |
| RTL surfaces | `check-rtl-ui` when UI is RTL |
| Pixel-match a hand mock | `image-to-code` only if they supply PNG |
| Multi-feature code cleanup | **stop** → `clean-repo-by-feature` |

## Run folder (mandatory)

Each run gets one folder outside the repo, so parallel campaigns do not overwrite. Never write run files into the repo. STATE, MATRIX, AUDIT and TASTE below are `##` sections of one `report.md`:

```text
${XDG_STATE_HOME:-~/.local/state}/agent-setup/runs/<repo>/improve-ux/
  <YYYY-MM-DD-HHMM>/   # one folder per run, local time
    report.md          # ## State, ## Matrix (flows / lanes), ## Audit (scores + evidence), ## Taste (variants + chosen direction)
    planpage-*.json
    mocks/
    *.html             # planpage outputs
```

```bash
SKILL="improve-ux"
COMMON_GIT_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
REPO_ROOT=$(dirname "$COMMON_GIT_DIR")
REPO=$(basename "$REPO_ROOT")
RUNS="${XDG_STATE_HOME:-$HOME/.local/state}/agent-setup/runs/$REPO/$SKILL"
RUN_DIR="$RUNS/$(date +%Y-%m-%d-%H%M)"
[ -e "$RUN_DIR" ] && RUN_DIR="$RUN_DIR-$$"
mkdir -p "$RUN_DIR"
REPORT="$RUN_DIR/report.md"
```

Resume → the run folder the user gives, else the newest one: `ls -1 "$RUNS" | tail -n 1` (do not start a new run).  
`LANE-BRIEF.md` lives **inside each worktree**; include `RUN_DIR`. Lanes share this run and never start their own.

Templates: [REFERENCE.md](REFERENCE.md).

## Control loop (no lazy stop / no repeated boards)

### State section

| Field | Values |
|-------|--------|
| `phase` | `audit` → `taste` → `implement` → `land` → `done` |
| `phase_status` | `pending` \| `in_progress` \| `complete` \| `blocked` |
| `scope` | free text: flow / feature / all-app |
| `surfaces` | `web` \| `mobile` \| `both` \| `apps` |
| `direction_id` | chosen taste variant id or `none` |
| `requested_through` | furthest phase user asked |
| `next_action` | one concrete verb |

**Every turn:** read STATE → MATRIX → AUDIT → TASTE → do **next incomplete** phase only.  
**Forbidden:** re-print a completed audit/taste board as the answer; one status line per subagent completion (batch-wait); spawn implement agents before `direction_id` is set.

### Resume after compact

Load STATE first. Resume mid-phase. Never re-fan-out a second wave of the same flows unless user asks a new campaign.

---

## MUST-score axes (every audit)

Score each in-scope journey (evidence, not vibes):

1. **Click / step count** — actions to job complete  
2. **Redirects / route hops** — pages and dead ends  
3. **Layout hierarchy / scanability**  
4. **Form friction** — fields, defaults, validation, steps  
5. **Empty / error / loading** states  
6. **Mobile layout / thumb reach**  
7. **Accessibility basics** — labels, focus, contrast, landmarks  
8. **Motion / delight** — meaningful animation (not noise)  
9. **Creative craft** — icons, SVG, color — **unique when it serves the product** and improves the journey  
10. **Product density** — chrome richness vs production (must not drop without written reason)  

Restyle is **allowed** when the journey clearly improves. Prefer product-appropriate boldness over generic AI UI. **Never** trade craft density for a lower click count alone.

## Surfaces

- **Web + mobile + apps** are in scope.  
- **Same flow may own web + mobile** when shared UX lives in one repo.  
- Split agents by package only when monorepo packages are clearly separate **and** user scope implies it.

## Safety

- No force-push protected tip; no remote branch deletes unless listed.  
- Product commits only on topic branches.  
- Full product fair game by default; honor explicit “don’t touch X”.  
- Never print secrets.  
- Headless e2e default when running gates.

---

## Workflow

# Phase 1 — audit (cheap, no implement agents)

1. Resolve repo, stack, design tokens / UI kit paths, routes, main user jobs.  
2. Scope from user: one flow / feature / multi / all app. If all-app, inventory journeys; still **one global taste** later.  
3. Map current journeys: steps, routes, entry/exit, drop-off risks.  
4. Score MUST axes with proof (file paths, route names, step counts).  
5. Write the Audit + Matrix sections of `report.md` (proposed lanes = flows/features user scoped).  
6. **planpage (audit):**  
   - Mermaid **before** flow diagrams (current)  
   - Proposed **after** flow diagrams (target)  
   - Scoreboard of friction  
   - Portfolio view of all proposed lanes  
7. Open with `--open`. Prefer `--serve` when you need a decision on which flows matter; otherwise diagrams are enough.  
8. STATE: `phase: taste`, `next_action: render taste mocks`.

**Do not** open issues/PRs/worktrees yet.

---

# Phase 2 — taste (high-fi + must-feel-different — required before implement)

**Goal:** lock visual + journey direction with **product-grade** mocks the user can **feel** are different — **no worktrees/PRs yet**.  
“Cheap” = no multi-agent implement — **not** thin visuals, **not** “same UI + more panels.”

### 0. Ground in the real product (mandatory)

1. Identify primary UI surfaces, design tokens, CSS variables, component library.  
2. Capture **current** for the sample flow at a **named moment** (lock this as `compare_state`):  
   - Prefer live screenshot (`run-local-and-check` / browser)  
   - Else faithful reconstruction from real components  
3. List chrome inventory (rail, header, modes, canvas, preview, inspector, status, secondary CTAs).  
4. Craft references (genshot, vybekiit, in-repo marketing) = **density + signature**, not brand theft.

### 1. Same-state compare (mandatory)

| Field | Rule |
|-------|------|
| `compare_state` | One of: `empty-build` \| `in-progress` \| `proven` \| `ship-ready` (or repo-specific label) |
| **Current panel** | Live screenshot/reconstruction **in that state only** |
| **Every variant** | Same `compare_state` — if you want a success modal, show **current proven** vs **proposed proven**, not empty vs celebrate |

Unfair compare (idle live vs success mock) → **self-reject**.

### 2. Variant set + hard axes

1. Global direction + one sample flow.  
2. Default **3** variants with roles in Quality bar (`conservative` / `balanced` / `bold`).  
3. For **each** variant, fill in TASTE:

```text
hard_axes: [color|layout|motion|craft]  # ≥2; bold ≥3 incl color+layout
axis_proof:
  color: …
  layout: …
  motion: path to CSS or recording
  craft: …
compare_state: empty-build
feel_test: pass|fail — why
```

### 3. High-fidelity mock rules (each variant)

Each mock `$RUN_DIR/mocks/<id>.html` **must**:

| Rule | Detail |
|------|--------|
| **Desktop product frame** | min ~1200px content width |
| **Same product job** | Still this product’s workspace — not a random SaaS marketing site |
| **Real micro-UI** | Real labels, chips, empty states, secondary actions, status, lists — dense |
| **Hard axes met** | ≥2 axes (bold ≥3) with visible proof in the mock itself |
| **Journey delta** | How steps drop **inside** the redesigned dense UI |
| **Motion** | If motion is a claimed axis: **CSS animations that run on load/hover/click** in the HTML; optional `$RUN_DIR/mocks/<id>-motion.mp4` / gif. Caption-only = fail |
| **Click + density** | before→after steps; density ≥ production unless justified |

**Side-by-side planpage:** current (same state) | variant A | … with hard-axis chips.  
Picks: `direction.conservative` | `direction.balanced` | `direction.bold`.

### 4. Self-reject before showing the user

Rebuild if any:

- Thinner/emptier than production  
- Hard axes &lt; required / bold still 1:1 paper+primary  
- Same 3-column bones with only extra checklists/modals  
- Different `compare_state` than current  
- Motion claimed without playable CSS/recording  
- “Scenario passed” as the whole design  
- Feel test fails (“covers labels → looks like prod screenshot”)

### 5. Write + stop

1. Taste section: chrome inventory, `compare_state`, per-variant hard axes + proofs, click/density, feel_test.  
2. Render planpage + open mocks (user can open HTML to **see** CSS motion).  
3. **Stop** for pick / like / “go with X”.  
4. On pick: freeze `direction_id` + design rules (include hard-axis commitments), STATE → implement.

**Forbidden before pick:** implement subagents, implement issues/PRs.

---

# Phase 3 — implement (after direction pick only)

Once `direction_id` is set (or user clearly locks direction in chat):

1. STATE `phase: implement`, `phase_status: in_progress`.  
2. Lanes = MATRIX rows user scoped (or all proposed if they said all). **As many agents as needed** — no artificial cap; still one owner per lane.  
3. Unit of work = **what the user said** (flow, feature, screens). Default split: one agent per **user flow** when multi.  
4. For **each** lane:  
   - Create **GitHub issue** (always, even single flow)  
   - Worktree + branch `ux/<issue>-<slug>` (or `feat/` if repo convention)  
   - Write `LANE-BRIEF.md`: scope paths, **exact liked direction**, non-goals, proof commands, **stop at open PR**, no merge  
   - Spawn agent (host A default) **cwd = worktree**  
5. Implement **exactly the liked planpage direction** — no silent redesign mid-PR; **no craft regression** vs production or the liked mock.  
6. Creative craft **required** when it improves the journey (motion, SVG icons, color) — target genshot/vybekiit-class density on this product’s chrome.  
7. Same flow may edit web + mobile surfaces when that is the UX.  
8. Proof bar **per lane** (honest skip with reason):  
   - Update flow diagrams (before → after)  
   - `run-local-and-check` local smoke when runnable  
   - Narrow e2e/happy-path when suite exists  
9. `organize-commits` + `finish-and-push` → **open PR** `Fixes #<issue>`. **Do not merge.**  
10. Batch-wait agents → one MATRIX update (PR URLs, SHAs, proof).  
11. **planpage implement review:**  
    - Portfolio of all lanes  
    - Per-lane before/after (CodeExplorer / screenshots / diffs + diagrams)  
12. Optional **umbrella branch** only if user asked “one full UI branch” — otherwise **separate PR per flow**.  
13. STATE: implement complete; `next_action: wait for like/land or more tweaks`.

### LANE-BRIEF must include

- Chosen `direction_id` + 5 bullet design rules from TASTE  
- Click/step target for this flow  
- Surfaces (web/mobile/apps paths)  
- MUST-score checklist  
- Stop at open PR; no remote delete; no tip commits on default  

---

# Phase 4 — land (only when user says)

1. Merge only PRs they named or marked liked + “land/merge”.  
2. Prefer `gh pr merge`; never force-push tip.  
3. Post-land: quick verify / e2e if present.  
4. Local worktree cleanup only if they ask close/prune.  
5. STATE `phase: done` when campaign finished.

---

# planpage guide

| Page | When | Content |
|------|------|---------|
| Audit portfolio | end of audit | Flow diagrams before/after, scores, proposed lanes |
| Taste | end of taste | Same-state current vs variants; hard-axis chips; playable motion; OptionCompare / picks |
| Implement portfolio | end of implement | All PRs, metrics deltas |
| Per-lane | each PR | Before/after UI + diagram + proof |

Load the **`plan-page`** skill. Prefer `plan-brief`, `before-after`, `code-style-plan` / CodeExplorer as fits. Use Mermaid for **user** steps, not git plumbing.

```bash
npx planpage render plan-brief \
  --data "$RUN_DIR/planpage-audit.json" \
  --out "$RUN_DIR/audit.html" \
  --open
```

## Host modes

| Host | Default |
|------|---------|
| **A** | Background subagents per lane (default) |
| **B** | cmux terminal per lane if user wants watch/join |
| **C** | Briefs only (no claim agents ran) |

---

## Verification

### audit

- [ ] AUDIT + MATRIX + flow diagrams on planpage  
- [ ] All MUST axes scored with evidence  
- [ ] Zero implement agents / PRs  

### taste

- [ ] Live product grounded; `compare_state` locked; **same-state** before/after  
- [ ] 2–4 high-fi mocks; density ≥ production unless justified  
- [ ] Each variant hard axes ≥2 (bold ≥3 incl color+layout); axis proofs in TASTE  
- [ ] Bold does **not** clone live paper+primary 1:1  
- [ ] Motion axis only with playable CSS and/or recording  
- [ ] Feel test pass (not “prod + extra panels”)  
- [ ] No lo-fi / unfair state compare / caption-only motion  
- [ ] User pick → `direction_id`; zero implement agents before pick  

### implement

- [ ] Issue + worktree + PR per lane  
- [ ] Direction followed  
- [ ] Proof: diagrams + preview + e2e (or honest skip)  
- [ ] Portfolio + per-lane planpage  
- [ ] No merge unless user said land  

### land

- [ ] Only requested PRs merged  
- [ ] Tip advanced via PR only  

```text
repo: <path>
scope: <flow|feature|all>
surfaces: web|mobile|both|apps
phase: audit|taste|implement|land|done
direction_id: <id>|none
lanes: N
issues: […]
prs: […]
proof: diagrams=… preview=… e2e=…
merged: none|[…]
residual: …
report: <RUN_DIR>/report.md
```

**“Agents ran” is not success.**  
audit → understood journeys + diagrams.  
taste → direction locked with **high-fi mocks the user can feel** (hard axes + same-state + motion proof).  
implement → reviewable PRs matching liked direction at production+ craft.  
land → only on explicit ask.  
Never spawn implement before taste pick.  
Never ship taste that looks worse than live **or** is live-with-extra-chrome only.
