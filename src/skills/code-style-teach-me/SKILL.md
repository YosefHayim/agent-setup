---
name: code-style-teach-me
description: Use when you want to learn your project rules while you build. At each real choice it shows two options, waits for your pick, and explains the rule. Say "coach me", "teach me as we build", or "explain while we code". To review a finished change, use code-style-review.
---

<what-to-do>

We build together, but I want to **learn my own codebase as we go** — not just watch you type. So
at each **real decision**, stop and coach me: explain the concept simply, show me two concrete
variants, and make me **confirm the direction before you write**. Then teach me *why* and show me
the file to imitate. I get better; the code stays on-style.

**Read first (never coach from memory):** the rules in `~/.claude/rules/` (`code-style.md`,
`repo-layout.md`, `stack-choices.md`), the repo's `AGENTS.md` exceptions when it has any,
and `PROJECT.md` / `CONTEXT.md` when present (so "where does this go" comes from *my* docs, not generic advice).

**Only grill me on what matters.** Biome built-in rules are the only tool that checks style:

- A rule Biome enforces → **a tool already enforces this. Do NOT grill
  me on it** — just follow it and let `biome check` catch any slip. Silence here is the point;
  formatting and mechanical rules are not decisions.
- Placement, architecture, and the stack choices in `stack-choices.md` → **this is where you stop and coach.**
  These are the calls a machine can't make, so they're the ones worth my attention.

When several judgment decisions are live, fire them in **one** `AskUserQuestion` (the host TUI question card). Recommended option first, marked `(Recommended)`; code variants go in each option's `preview`. Do not drip live questions one-by-one. Do not invent future decisions just to fill a card. A second card is only for questions that could not exist until these answers landed.

</what-to-do>

<supporting-info>

## The loop — at each judgment decision

1. **Locate it against my docs + the standard.** Which unit is this (feature, hook, command, …)?
   Where does it belong per `PROJECT.md`/`CONTEXT.md` and `repo-layout.md`? Find the closest existing thing to **extend, not duplicate**.
2. **Explain the concept KISS**, in terms I already know — one or two sentences, plain. Anchor a new
   idea to one I've already used in this repo ("this is like the `settings` pure/IO split you saw").
3. **Show two concrete variants** via `AskUserQuestion` — put the real code in each option's
   `preview`. Variant A vs B on the actual decision (e.g. "pure `check*` + thin fetch" vs "one fused
   function"; "extend `features.ts`" vs "new module"). Cite `file:symbol` from this repo. If more
   than one judgment call is live, they share this card.
4. **Make me pick — and WAIT on the card.** High friction: do not write the code until I answer the
   card. If I pick, that direction is locked; if I'm unsure, teach a bit more and re-offer. This is
   active recall — the point is that I *decide*, so I learn.
5. **Write it my way**, following the standard. Colocate the `*.test.ts`. Then in one or two lines,
   **teach the mechanism**: how this actually works here (the data flow / lifecycle / who calls it),
   and **link the file to imitate** ("mirrors `src/…`— open it to see the whole shape").
6. **Let the tools carry the mechanical half** — run `pnpm exec biome check --write .` and the
   repo's `verify`; never hand-fix what Biome owns, and never grill me about it.

## What counts as a "decision" worth stopping on

Stop for: **placement** (which layer/file, extend vs new), **shape** (pure/IO split,
one named return, what the feature owns), **the unit's usual path** (am I following an existing
feature or inventing?), and **an abstraction's justification** (YAGNI — does
a second real caller exist yet?). Don't stop for anything a tool enforces, or for a change that
plainly mirrors an existing file — just note "following `<file>`" and move on.

## Edge cases to look for in every feature

Empty, one, many, slow or failed network, no permission, double submit, Hebrew right-to-left text.
Name which ones this feature meets and show how each is handled.

## Teaching depth (keep it light, cumulative)

Per decision: the concept (1–2 lines) → who/when it runs → the file to imitate. Over a session
this compounds into real understanding of the repo's architecture — you're building my mental model,
not narrating keystrokes. If I ask "why this way?", give the reason from `~/.claude/rules/` or the
tool's official docs, not just the rule.

## Never

- Never coach from memory — re-read `~/.claude/rules/`, the `AGENTS.md` exceptions and `CONTEXT.md` for this change.
- Never grill me on a rule a tool already enforces — just follow it.
- Never write the code before I've confirmed the direction on a judgment decision.
- Never invent a pattern when an existing file fits — mirror it and tell me which.
- Never add an abstraction for a second consumer that doesn't exist yet (YAGNI).

</supporting-info>
