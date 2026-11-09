---
name: explain-my-stack
description: Use when you want to understand why your project uses each tool — language, framework, and services. For each one it explains the trade-offs simply, lets you choose, and explains how it works, all in chat. Say "why this stack" or "why TypeScript and not Python". For code style, use code-style.
---

<what-to-do>

Interview me about **why this project is built on the technologies it is** — language, runtime,
framework, meta-framework, and the load-bearing services/vendors — in one TUI question card, until I
could **explain each choice to someone else**. This is a different axis from `code-style`
(which is *how we write code here*); this is ***why this stack, and how it works***.

**Dedup within the chat.** Whatever decision or glossary term you already explained earlier in this
conversation, I already learned — **do not re-teach it.** Only grill me on, and only explain, what's
genuinely new. The answers stay in chat; never save them to a file.

For each decision, the point is **active recall + honest tradeoffs**, never a sales pitch:
- **Teach the tradeoff space in plain terms** — what each option costs, and what you'd *gain* for
  paying that cost. Concede the real strengths of the option we *don't* pick (Go really is great for
  CLIs — just not here). A choice I can't argue against the alternative to, I don't understand.
- **Make me pick, and WAIT on the card.** Recommend one with your reasoning, but the call is mine. High friction.
- **Then explain how it works** — the mechanism of the thing we chose (what runs it, in what order),
  concretely enough that I picture it.

Fire every unsettled stack decision in **one** `AskUserQuestion` (the host TUI question card).
Teach the tradeoff space in each option's detail. Recommended option first, marked `(Recommended)`.
Do not drip questions one-by-one. A second card is only for questions that could not exist until
these answers landed.

**Answer only after I've decided.** After the card returns, explain each resolved decision in chat per
**[TEACH-FORMAT.md](TEACH-FORMAT.md)**: a **lean decision block** on top + a **self-closing,
cited glossary** below (every term explained, every term *used inside* a term also explained, one
short code snippet each). Skip anything already explained in this chat.

</what-to-do>

<supporting-info>

## What counts as a "stack decision" worth grilling

Walk these in dependency order inside **one** card (language first, then runtime, then framework, then vendors); skip any already covered in this chat:

1. **Language** — why this one, vs the obvious alternatives for this domain (TS vs Python vs Go vs
   bash…). The deciding lens is usually **substrate fit**: what ground does the code already run on?
2. **Runtime / host** — where it executes (Node · edge/worker · browser · native · a specific
   vendor's runtime) and why that constrains everything above it.
3. **Framework & meta-framework** — the "why a framework at all", then the specific pick and its
   sibling (React vs Next vs Remix; Express vs Hono; Expo vs bare RN). Name what the meta-framework
   *adds* over the base and whether this project needs it.
4. **Key services / vendors** — the load-bearing external choices (DB, auth, hosting, queue, AI
   provider…). Why this vendor, what it's traded against, and the lock-in cost.

Only the **load-bearing** decisions — the ones a new contributor would ask "why did they pick that?".
Don't grill me on every transitive dependency; a minor lib is a `code-style` "how to use it"
concern, not a stack decision.

## The loop — per decision

1. **Locate & dedup.** Was this already covered in this chat? If yes, skip it (mention it's covered). Ground
   the framing in `PROJECT.md`/`CONTEXT.md` — what is this project actually for? — so the tradeoff is
   judged against *our* needs, not a generic benchmark.
2. **Teach the tradeoff space (KISS).** 2–4 candidates, one honest line each: its strength, its cost
   *here*, and what you'd gain for that cost. Never trust memory for a factual claim (a version, a
   limit, "X doesn't support Y") — **verify with WebSearch and cite the official doc.**
3. **Recommend + show alternatives via one `AskUserQuestion`.** Put the real tradeoff in each option's
   detail. Concede the rejected option's genuine strengths. Unsettled decisions share this card.
4. **Make me pick — and WAIT on the card.** Don't write until I answer. If I'm unsure, teach a bit more, re-offer.
5. **Explain how the chosen thing works** — the mechanism (what executes it, the order it runs in),
   concrete enough to picture. Offer to hand a real deep-dive to the **`teach`** skill (which builds
   cited, multi-session lessons) — this skill teaches the *decision*, `teach` teaches the *concept*.
6. **Answer in chat** per [TEACH-FORMAT.md](TEACH-FORMAT.md) — lean decision + self-closing
   cited glossary (code snippet per term), skipping terms already explained in this chat.

## The principle to keep surfacing: substrate fit

Most language/runtime decisions collapse to one question — **what ground does the code already run
on?** Match the language/tool to that ground before arguing syntax or speed. It's the through-line
that explains "why TS not Go/Python/bash" for a Node-hosted tool, and it flips cleanly when the ground
changes (data/ML → Python; a standalone perf-critical binary with no host → Go). Teach the principle,
not just the verdict, so I can re-derive the next decision myself.

## Boundaries — three places, three jobs

- **The chat answer** ← *this skill writes here.* Why-this-stack decisions + a beginner-safe,
  self-closing glossary of **general** tech terms. Deduped within the chat; never saved to a file.
- **`LANGUAGE.md`** ← *leave it alone.* It's the human↔agent bridge for **domain** vocabulary (the
  project's ubiquitous language). Only touch it if a genuinely *domain* term surfaces — general tech
  literacy ("what's an interpreter") is not domain language and belongs in the chat answer.
- **PR description** ← *only when a pick changes the project.* The terse, maintainer-facing "why"
  goes in the PR description of that change; the chat answer stays the human-friendly teaching version.

## Never

- Never sell a choice — teach the tradeoff and concede the alternative's real strengths, or I can't
  trust the verdict.
- Never state a factual claim (version, limit, capability) from memory — verify and cite the official
  doc.
- Never re-teach a decision/term already explained in this chat — explain only what's new.
- Never leave a term undefined inside another term's explanation — the glossary must close over itself.
- Never write the decision block before I've made the decision; never save the answers to a file;
  never write general tech terms into `LANGUAGE.md` (that doc is domain-only).
- Never write the code before I've confirmed the direction on a judgment decision.

</supporting-info>
