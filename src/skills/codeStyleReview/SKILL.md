---
name: code-style-review
description: Use when you want to check a big change (a branch, a PR, or AI-written code) against the project style rules without reading every file. It fixes simple problems, checks the rest with helper agents, and lists only the real problems. Say "review this" or "can I trust this diff". To learn while you build, use code-style-teach-me.
---

<what-to-do>

I changed a lot of files and I want to **trust the batch without reading every diff** — and come
out **understanding what changed**, not alienated from my own code. So collapse the diff into a
short, teaching report: let the machine carry the mechanical load, and spend judgment (and my
attention) only where a machine can't.

**Read first:** the rules in `~/.claude/rules/` (`code-style.md`, `repo-layout.md`, `stack-choices.md`)
and the repo's `AGENTS.md` exceptions when it has any, plus `PROJECT.md`/`CONTEXT.md` when present, and **my original
prompt/intent** (ask me for it if you don't have it — Tier 3 checks the diff *did what I asked* and
flags scope creep). The repo far from the rules (old `CODE-STYLE.md`, no Biome)? Offer `code-style` (Adopt) first.

**Scope the diff** (ask if unclear): `git diff <base>...HEAD` (branch/PR), the uncommitted working
tree, or a named PR. That file list is the review surface.

</what-to-do>

<supporting-info>

## The three tiers — cheapest enforcement first

Biome checks what it can, so most mechanical problems never reach me:

1. **Tier 1+2 — deterministic, whole-tree, auto-fix.**
   Run the repo's own gate (`verify`: lint, typecheck, tests, build). Lint is Biome built-in rules.
   For the safe fixes run `pnpm exec biome check --write .` on the changed files (commit or stash
   first so the fixes stay separate). Re-run to green. I read
   **nothing** for this tier. Never weaken a rule/test to go green — fix the code.
2. **Tier 3 — judgment, fanned out over the diff.** For what no tool checks (the rules in `~/.claude/rules/`: names, conditions, functions, modules,
   `stack-choices.md`, placement, architecture, the repo's exceptions) + **my intent**,
   split the changed files into slices and dispatch
   read-only sub-agents (see below). Each returns **only deviations** — never a file dump.

## Fan-out (Tier 3)

Group the changed files into coherent slices (by layer/feature/directory). For each slice, launch a
`subagent_explore` with: the slice's file list, the three files in `~/.claude/rules/`
and the `AGENTS.md` exceptions, the relevant `CONTEXT.md` terms, and **my original prompt**. Ask each to report, per
finding: `file:line` · which rule/intent it breaks · the one-line fix · the file it should
mirror. Tell them explicitly: **report deviations only; stay silent on conforming code.** Aggregate,
dedupe, and rank (intent-misses and architectural breaks first, nits last).

## The report — teaching, deviations-only

Open with **orientation, then findings**:

- **Layer/flow map** — an ASCII map (via `ascii-architecture-flow-mapper`) of the layers/modules the
  diff touched and **how the change blended in** (new module → which layer, who calls it). This is
  the lesson: I see the shape of what changed, not 300 diffs.
- **Intent check** — one line: did the diff do what I asked? Any scope creep?
- **Findings** — each: `file:line`, the rule/intent broken, **why it matters** (the rationale /
  the pattern it protects — this is how I learn), the fix, and the file to imitate.
  Clean slices get a one-line "✓ conforms" — never a diff dump.
- **Verdict** — `verify` state + counts per tier. Auto-fixed (Tier 1+2) items are summarized, not
  itemized.

**Friction:** auto-fix everything the Biome tiers own; for each **judgment** finding, don't silently
rewrite architecture — surface it and **make me decide** (keep / fix / accept). That decision is
where I learn. Render the report as an interactive **planpage** (`before-after` / `plan-brief`) when
I want to approve/reject findings in the browser; otherwise ASCII inline.

## Never

- Never claim the batch is clean from reading alone — Tier 1+2 must be green (run it).
- Never weaken a Biome rule, edit the config, or skip/loosen a test to reach green — fix the code.
- Never dump conforming diffs — the report is deviations + the teaching map only.
- Never rewrite a `judgment`-level architectural choice without my decision.
- Never review a judgment rule from memory — read it from `~/.claude/rules/` or `AGENTS.md`.

</supporting-info>
