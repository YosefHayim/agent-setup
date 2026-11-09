# Improve UX — templates

## report.md

One file per run: `$RUN_DIR/report.md`. It starts with `# Improve UX — <repo>`, then holds the four `##` sections below in this order.

### State section

```markdown
## State

updated: <ISO date>
phase: audit | taste | implement | land | done
phase_status: pending | in_progress | complete | blocked
scope: <e.g. checkout flow | all-app | settings>
surfaces: web | mobile | both | apps
direction_id: none | direction.conservative | direction.balanced | direction.bold | …
requested_through: audit | taste | implement | land
host: A | B | C
product_tip: <ref> @ <sha>
run_dir: <RUN_DIR>
next_action: <one concrete verb>
block_reason: none | waiting for taste pick | …
lanes_total: N
lanes_pr_open: N
lanes_merged: N
notes: <one line>
```

### Matrix section

```markdown
## Matrix

| id | Journey / flow | Surfaces | Paths (globs) | Issue | Branch | Worktree | PR | Head | Proof | Notes |
|----|----------------|----------|---------------|-------|--------|----------|-----|------|-------|-------|
| onboarding | First-run → home | web+ios | app/onboarding/**, apps/mobile/**/Onboarding* | #12 | ux/12-onboarding | .worktrees/… | #40 | abc | diagrams+preview | |
```

### Audit section

```markdown
## Audit

Updated: <ISO date>
Scope: …
Product tip: `<ref>` @ `<sha>`

### Journey map

| id | Job to be done | Entry | Exit | Steps now | Route hops | Pain |
|----|----------------|-------|------|-----------|------------|------|
| checkout | Pay and confirm | /cart | /success | 9 | 5 | account wall mid-flow |

### MUST scores (per journey)

| id | Clicks | Redirects | Layout | Forms | Empty/Error/Load | Mobile | A11y | Motion | Craft | Overall |
|----|--------|-----------|--------|-------|------------------|--------|------|--------|-------|---------|
| checkout | 3/10 | 4/10 | … | … | … | … | … | … | … | FIX |

Score 1–10 (10 = excellent). Cite paths / routes under each low score.

### Proposed after (target steps)

| id | Steps target | Key change |
|----|--------------|------------|
| checkout | 5 | guest pay; combine address+shipping |

### Sample flow for taste

`<id>` — why highest leverage
```

### Taste section

```markdown
## Taste

Sample flow: <id>
Variant count: N (why this N)
Craft bar: production + genshot/vybekiit-class density
Grounding: live screenshot | component reconstruction | both
compare_state: empty-build | in-progress | proven | ship-ready | <custom>
# All variants MUST use the same compare_state as the current panel

### Chrome inventory (from live UI)

| Region | Keep | Cut only if | Notes |
|--------|------|-------------|-------|
| app rail | yes | AUDIT friction-only | … |
| header actions | yes | … | … |
| mode strip | yes | … | … |
| main canvas | yes | … | … |
| preview / device | yes | … | … |
| inspector / sidebar | yes | … | … |
| status / run control | yes | … | … |

### Current reference

- screenshot: <RUN_DIR>/current-sample.png (or path)
- density score production: N/10

### Variants

#### direction.conservative
- Role: polish same shell; still ≥2 hard axes
- hard_axes: [craft, motion]
- axis_proof:
  - craft: …
  - motion: CSS in mock / recording path
- Layout: …
- Color: … (may keep primary; must improve surfaces)
- Click delta: 9 → 7
- Density after: N/10
- Mock: <RUN_DIR>/mocks/conservative.html
- feel_test: pass|fail — …

#### direction.balanced
- Role: one structural change + craft; hard_axes must include layout
- hard_axes: [layout, craft, …]
- …

#### direction.bold
- Role: new design language in 2 seconds; ≥3 axes incl **color + layout**
- hard_axes: [color, layout, craft|motion]
- Palette: MUST NOT clone live paper+primary 1:1
- …

### Chosen

- id: direction.…
- locked_at: <ISO>
- user_notes: …
- design rules (freeze for implement):
  1. …
  2. …
  3. …
  4. …
  5. …
  6. chrome keep list: …
```

## Issue body (always create)

```markdown
## User job
…

## Current friction
- steps: N → target M
- redirects: …
- layout / form / mobile / a11y notes: …

## Direction (locked)
`direction_id` — …

## Scope paths
- …

## Out of scope
- …

## Proof
- [ ] Flow diagram updated
- [ ] run-local-and-check smoke
- [ ] narrow e2e if present

## Done
Open PR only. Do not merge.
```

## LANE-BRIEF.md (inside worktree)

```markdown
# UX lane — <flow> · Fixes #<n>

You own ONLY this journey’s paths. Direction is LOCKED — implement it, do not invent a new brand.

## direction_id
…

## Run folder
<RUN_DIR> — shared with the orchestrator; do not start your own run

## Design rules (from TASTE)
1. …
2. …
3. …
4. …
5. …

## Paths
…

## Surfaces
web | mobile | both — …

## MUST checklist
- [ ] fewer steps / hops (record before→after counts)
- [ ] layout hierarchy
- [ ] forms / empty / error / loading
- [ ] mobile thumb reach
- [ ] a11y basics
- [ ] meaningful motion
- [ ] craft (icons/SVG/color) serves the journey

## Proof
- Update mermaid before/after for this flow
- run-local-and-check when app runnable
- narrow e2e if exists; else skip: reason

## Stop
- organize-commits + finish-and-push → open PR Fixes #<n>
- Do NOT merge. Do NOT touch other lanes. Do NOT force-push tip.
```

## planpage-audit.json (sketch)

```json
{
  "title": "UX journey audit — <repo>",
  "summary": [
    { "label": "Journeys", "value": "N" },
    { "label": "Worst friction", "value": "checkout 3/10 clicks" },
    { "label": "Next", "value": "taste mocks (no code yet)" }
  ],
  "notes": [
    {
      "tone": "decision",
      "title": "No implement yet",
      "body": "Pick taste direction on the next page before any worktrees."
    }
  ],
  "steps": [
    { "label": "Map journeys", "status": "done", "detail": "report.md Audit section" },
    { "label": "Score MUST axes", "status": "done", "detail": "evidence paths" },
    { "label": "Taste mocks", "status": "todo", "detail": "2–4 high-fi product-grounded variants" }
  ]
}
```

Include Mermaid `flow` blocks for **before** and **after** user steps on the rendered page.

## planpage-taste.json (sketch)

Use OptionCompare / PickBlocks with `data-id` = `direction.*`.  
Each option: **link to full high-fi mock HTML** (desktop width) + click-delta + **density score** + craft note.  
Always include a **current** panel (screenshot or faithful reconstruction) beside variants.

## Anti-patterns

| Bad | Good |
|-----|------|
| Spawn 12 implement agents on first message | Audit + taste pick first |
| Redesign mid-PR away from liked direction | Follow `direction_id` rules |
| Merge without user land | Stop at open PR |
| Generic purple AI UI / lo-fi wireframes | High-fi craft grounded in live chrome |
| “Scenario passed” empty success mock | Same workspace, better journey + states |
| Flatten 3-pane product to 1 marketing card to cut clicks | Cut steps **inside** dense product UI |
| Mock thinner than production | Density ≥ production unless AUDIT justifies cut |
| Same shell + stepper/modal only (“bold”) | Hard axes: bold = color + layout + third axis |
| Idle live vs celebrate mock | Same `compare_state` both sides |
| “More motion” caption only | Playable CSS and/or short recording |
| Skip mobile when scope is apps | Same flow can own web+mobile |
| Reprint audit board after compact | Resume STATE next_action |
| One mega-PR without ask | Per-flow PR; umbrella only if requested |
| Thumbnail-only taste | Side-by-side same-state current vs full product-frame after |
