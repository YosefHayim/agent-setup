# CONTEXT.md Format (this stack)

`CONTEXT.md` is **orientation only** — what the project is, who the actors are,
and how the system is shaped. It is **not** the glossary, not purpose/roadmap,
and not coding rules.

| File | Role |
| --- | --- |
| `PROJECT.md` | Purpose & direction — [PROJECT-FORMAT.md](PROJECT-FORMAT.md) |
| `CONTEXT.md` | Orientation (this file) |
| `LANGUAGE.md` | Names-only glossary — [LANGUAGE-FORMAT.md](./LANGUAGE-FORMAT.md) |
| PR description | Individual hard-to-reverse decisions |
| `AGENTS.md` | How to work in the repo, and its `## Exceptions to code-standard` |

**Canonical exemplar:** `ai-browser-bridge/CONTEXT.md` (orientation sections; no
glossary blocks). agent-setup's own `CONTEXT.md` is a second good short example.

## Why this differs from upstream Matt Pocock

Matt Pocock's domain-modeling skill puts the glossary **inside** `CONTEXT.md`
under `## Language` (term anatomy: bold term / definition / `_Avoid_:`). That
anatomy is still correct — we keep it — but we **house it in `LANGUAGE.md`** so
orientation and names do not fight for the same document.

If you find a `## Language` block (or any `**Term**` / `_Avoid_:` glossary) inside
an existing `CONTEXT.md`, migrate those terms into `LANGUAGE.md` using
[LANGUAGE-FORMAT.md](./LANGUAGE-FORMAT.md) and leave orientation prose here.

## Structure

```md
# CONTEXT.md — {Project}

Orientation: what this is, its moving parts, and how they fit. For the words, see
`LANGUAGE.md`; for purpose and direction, `PROJECT.md`; for how to work in the repo
and how it differs from code-standard, `AGENTS.md`.

## What it is

{One or two paragraphs: what this system is, who uses it, the core loop.}

## Actors

- **{Actor}** — {role in the system}

## Shape

{How the major pieces fit. Paths, surfaces, and boundaries — not a glossary.
Diagrams and short tables of actors/parts are fine when they orient.}

## Where to start reading

{Optional. Entry files / read order — keep short; full map lives in `AGENTS.md`.}
```

### Optional sections (when needed)

- **How the pieces relate** — relationships between the actors (use LANGUAGE terms in bold).
- **Where state lives** — persistent vs ephemeral state boundaries.
- **Bounded contexts** — only multi-context repos; link `CONTEXT-MAP.md` or sibling `CONTEXT.md` files. Do **not** list term definitions here.
- **Key constraints** — hard platform/runtime limits that orient (not a roadmap).

### Forbidden in CONTEXT.md

| Forbidden | Put it in |
| --- | --- |
| Glossary blocks (`**Term**` + `_Avoid_:`) | `LANGUAGE.md` |
| `## Language` section | `LANGUAGE.md` |
| Purpose, goals, non-goals, roadmap Built/Next/Maybe | `PROJECT.md` |
| Decision rationale | The PR description |
| Code-style rules | the `code-standard` package; repo exceptions in `AGENTS.md` |
| Long implementation walkthroughs | code; link only |

## Rules

- **Orientation only.** A new agent should absorb this in one screen.
- **Use LANGUAGE terms** when naming domain things; do not redefine them here.
- **Create lazily.** Write `CONTEXT.md` when actors/shape need documenting — not as a glossary dump.
- **Title form:** `# CONTEXT.md — {Project}` (same family as `LANGUAGE.md — {Project}`).
