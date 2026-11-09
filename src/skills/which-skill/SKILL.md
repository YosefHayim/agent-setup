---
name: which-skill
description: Use when you are not sure which skill to use, or your prompt is long or messy (for example, from voice). It picks the right skill and gives you a short, ready prompt. Say "which skill", "how should I run this", or "refine my prompt".
type: flow
---

# Which skill (request router)

You are a **dispatcher**, not a second implementation of every skill, and **not a second conversation**.

Turn messy freeform (typing or dictation) into a **ready agent prompt** that reuses existing skills.

Default: **reuse existing skills**. Only suggest creating a new skill when the job is repeated, stable, and not covered (then `add-skill` / `save-as-skill` / `improve-skill`).

## How this should feel (product contract)

The user should **not** feel interrupted mid-session by a long “routing meeting.”

| Mode | When | What happens |
|------|------|----------------|
| **A — Input-side (preferred)** | STT release or “refine before send” | Draft is refined **before** a real agent turn. Refined text lands **in the focused input** (same caret STT already uses). User glances, hits Enter, **same session** continues with the real work. |
| **B — Same-turn silent (typed already sent)** | Messy freeform already submitted | In **this same turn**, classify → pick primary skill → **execute that skill immediately**. No multi-message “here is my routing card, wait for you.” At most one short line: *Using `finish-and-push`…* then do the work. |
| **C — Explicit advice only** | User asked “which skill?” only | Routing card + refined prompt; **do not execute** until they say “do it.” |

**Wrong:** open a separate routing chat, force Cmd+C / Ctrl+V as the main UX, or burn a full turn on a long plan when they already wanted the job done.

**Right:** refine → **input** (mode A) or refine → **same turn execute** (mode B). Clipboard is only an implementation detail inside STT paste (macOS already pastes via clipboard + ⌘V into the caret—user does not manage that).

### Relation to agent-voice

Dictation, prompt refinement, and read-aloud live in **agent-voice**, a separate app. When agent-voice refines a final transcript, it can type the refined prompt into the focused input (mode A). User proceeds with Enter. Session never “switches characters.”

The wiring lives in agent-voice; this skill defines **what** the refined string must contain. Do not invent a parallel product.

## Safety

- Do not invent skills that are not installed or cataloged.
- Manual-only skills (`disable-model-invocation: true` in their SKILL.md) start only when the user types `/<name>` (Claude Code) or `$<name>` (Codex): never run one in mode B; give the user the command to type instead.
- Do not skip safety of the target skill (no silent main commits, no remote delete, no deploy unless authorized).
- Prefer the **smallest** skill that fits.
- One **primary** skill; others are supporting only.
- Never strip quoted literals, paths, URLs, or code from the draft (same spirit as `refine_prompt` validation).

## Workflow

### 1. Capture the raw request

Keep user wording. Note workspace if known. Strip secrets from logs, not from the refined prompt the user needs.

### 2. Classify (one primary)

| Class | Freeform signals | Primary skill |
|-------|------------------|---------------|
| Ship / branch / PR / report when done | new branch, open PR, commit push, git commit push, commit push redeploy | `finish-and-push` |
| Split into clean commits | organize commits, organized commits, split commits | `organize-commits` |
| Readable code | no nested ifs, no ternaries, proper naming, make this readable | `make-code-readable` |
| Release a mobile app | release new version, internal testing, TestFlight, I don’t see it in TestFlight | `release-mobile-app` |
| Better screens and flows | better UX UI, user journey, this screen looks bad | `improve-ux` |
| Whole messy repo / every feature / backup main | multi-feature cleanup | `clean-repo-by-feature` |
| Parallel agents / worktrees | many lanes, fan-out | `run-tasks-in-parallel` setup-lanes |
| Land concurrent lanes | salvage, integrate worktrees | `run-tasks-in-parallel` land-lanes |
| Local UI prove | launch local, playwright, simulator, emulator, on my phone, relaunch so I see it, don’t deploy | `run-local-and-check` |
| Prod live prove | redeploy, is live, curl | `deploy-and-check` |
| Lean / ceremony | deslop, AI slop, ban payload | `simplify-code` |
| Whole-repo restructure | folders, names, deps, official docs, safe fixes and rule scan, clean all repos | `restructure-repo` |
| Personal code rules (new or existing code) | adopt my rules, style rules, review my repo against them | `code-style` |
| Kill ports | free ports, metro 8081 | `free-ports` |
| Bootstrap Code folder | clone all GH repos | `clone-all-repos` |
| Cloudflare ops | wrangler, D1 (not prove live) | `manage-cloudflare` |
| Session skill mining | repeated prompts | `find-repeated-prompts` |
| Fix a skill | skill misfired | `improve-skill` |
| New skill | add a skill, make a skill that… | `add-skill` |
| Bench A vs B | tokens, turns, same tasks | `benchmark-agents` |
| Unsure / voice dump | which skill | this skill → then primary |

See [REFERENCE.md](REFERENCE.md).

### 3. Build the refined prompt (the deliverable)

The refined prompt is a **single paste-ready agent message**, not a markdown report:

- Lead with skill trigger when helpful: `$finish-and-push` or clear “use finish-and-push”
- Explicit gates: branch name, open PR vs merge, deploy yes/no, report yes/no
- Exact strings/paths in quotes
- No filler, no “I will now…”, no multi-section essay

**Mode A (input-side):** only that string matters → inject into caret.  
**Mode B (same-turn):** use that string as the effective request and **run the primary skill now**.  
**Mode C (advice):** show a short routing card **plus** the same paste-ready string.

### 4. Mode A — input-side inject (preferred seamless path)

When the host/product can write the input field (STT worker after final transcript, or a refine-before-send binding):

1. Produce refined prompt only (no long card in the agent transcript unless debugging).  
2. Insert into the **focused agent input** (existing `type_text` / caret path).  
3. Stop. User edits if needed and submits. **No second session.**

### 5. Mode B — same-turn execute (typed/sent messy freeform)

When the user already sent a messy ask in this session:

1. Classify in one line max (optional).  
2. Load primary skill SKILL.md.  
3. Execute immediately under that skill.  
4. Do **not** wait for “ok run it” unless the ask was ambiguous on a destructive gate (merge, deploy, delete remote).

### 6. Mode C — advice only

If they only asked which skill / refine for later: short card + refined string. No execution.

### 7. New skill?

Only if repeated, stable, and uncovered → `add-skill` (from a description), `save-as-skill` (from what we just did), or `improve-skill` (fix an existing one). Else keep `which-skill` + primary.

## Verification

**Routed (mode A):** refined string is paste-ready; injected or ready for input; user can proceed without a routing conversation.

**Routed (mode B):** primary skill’s verification is the source of truth for “done”; routing was not a separate incomplete session.

**Advice (mode C):** primary id + refined string + “do not use” list present.

Do not claim success because you wrote a long skill essay. Success is **correct primary skill + ready prompt + same-session feel**.
