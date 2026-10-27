# PROJECT.md Format

`PROJECT.md` holds the project's **purpose and direction** — the "why we're
building this and where it's going" — for agents. `README.md` is the
human-facing version; `PROJECT.md` is what an agent reads to understand *intent*
before writing code.

| File | Role |
| --- | --- |
| `PROJECT.md` | Purpose & direction (this file) |
| `CONTEXT.md` | Orientation — [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md) |
| `LANGUAGE.md` | Names-only glossary — [LANGUAGE-FORMAT.md](LANGUAGE-FORMAT.md) |
| PR description | Individual hard-to-reverse decisions |
| `AGENTS.md` | Current structure / how to work in the repo |

**Canonical exemplars:** `planpage/PROJECT.md` and `agent-setup/PROJECT.md` (seven
sections). `ai-browser-bridge/PROJECT.md` is a valid close variant (same intent,
slightly different headings).

Create it lazily when purpose/direction is being pinned down — or by **extracting
it from an overloaded `CONTEXT.md`**: problem statements, core insight, and
roadmap belong here; domain names stay in `LANGUAGE.md`; orientation stays in
`CONTEXT.md`.

## Structure

```md
# PROJECT.md — {Project}

Purpose and direction. Read this to understand *why* the project exists and where
it's going; read `CONTEXT.md` for how it's shaped, `LANGUAGE.md` for the words,
and `AGENTS.md` for how to work in the repo. The code rules live in the `code-standard` package.

## The problem
{What problem this solves, and for whom. 2-4 sentences.}

## Who it's for
{The primary user/persona — and who is explicitly NOT the audience.}

## The core insight
{The key idea that makes this the right solution, and why now.}

## Goals
- {What success looks like, as an outcome.}

## Non-goals
- {What this deliberately does NOT do — the explicit out-of-scope.}

## Direction
- **Built:** {what exists today}
- **Next:** {decided but not built — link the issue or PR}
- **Maybe:** {options still on the table}

## Guiding principles
- {Non-negotiables that shape decisions — values, platform/budget limits. Deep rationale → the PR description.}
```

### Accepted heading aliases (do not invent more)

When validating an existing file, these count as the seven sections:

| Canonical | Also OK |
| --- | --- |
| The problem | Problem, Purpose (when it states the pain), Why it exists |
| Who it's for | Who it is for, Who it serves, Audience, Users, Target users |
| The core insight | Core insight, The approach, The wedge, Product promise, Why this |
| Goals | Success, Success criteria, What success looks like, Success metrics |
| Non-goals | Non-goals (now), What it is not, Out of scope |
| Direction | Status & direction, Current status, Roadmap (with Built/Next/Maybe) |
| Guiding principles | Principles, Constraints, Operating principles, Design principles |

Missing sections when **creating** a file: write the canonical seven. When
**validating** an existing file: report drift; do not mass-rewrite content without
approval.

## What to ask

`question-my-plan` and `code-style` both ask these when PROJECT.md is missing or thin. Fire every
unanswered item in **one** `AskUserQuestion`, each with a recommended default
pulled from the repo, `README`, or the conversation (same as any grill). Skip a
question only when the docs already answer it unambiguously.

1. **Problem & status quo** — What problem does this solve, for whom, and what does someone do today without it? → *The problem.*
2. **Who it's for / who it's not** — The primary user, and who is explicitly out of audience. Turn "everyone" into a real persona. → *Who it's for.*
3. **Core insight — why this, why now** — The key bet: why this approach beats the obvious alternatives, and why now is the moment. → *The core insight.*
4. **Goals as outcomes** — What is true when this is "working"? Push for outcomes ("a lead gets a scored PDF in one run"), not feature lists. → *Goals.*
5. **Non-goals** — What it deliberately will NOT do; what you'll say no to. Highest-leverage section for keeping agents in scope. → *Non-goals.*
6. **Direction** — What's Built, what's Next (decided — link the issue or PR), what's Maybe (still open). No aspirational fiction. → *Direction.*
7. **Guiding principles & hard constraints** — The values and non-negotiables shaping every decision (SSOT/KISS, platform limits, budget). → *Guiding principles*; deep rationale for any one choice goes in the PR description.

## Rules

- **Purpose and direction only.** The "why" of specific decisions lives in PR descriptions; don't restate it.
- **No glossary.** Domain terms belong in `LANGUAGE.md` ([LANGUAGE-FORMAT.md](LANGUAGE-FORMAT.md)).
- **No orientation dump.** Actors/shape belong in `CONTEXT.md`.
- **No current structure.** Repo layout / module ownership belongs in `AGENTS.md`.
- **Honest roadmap.** Mark Built / Next / Maybe. No aspirational fiction — if it doesn't exist and isn't decided, it's "Maybe" or it's absent.
- **Keep it short.** A page, not an essay.
- **Title form:** `# PROJECT.md — {Project}` (same family as `LANGUAGE.md — {Project}`).
