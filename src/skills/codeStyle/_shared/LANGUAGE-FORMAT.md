# LANGUAGE.md Format

`LANGUAGE.md` is the **human↔agent glossary** — names only. It pins the exact
words used in code, comments, commits, docs, and agent chat, plus the aliases to
avoid. Orientation lives in `CONTEXT.md`; purpose/direction in `PROJECT.md`;
coding rules in the `code-standard` package and the repo's `AGENTS.md`.

This is the stack adaptation of Matt Pocock's domain-language term anatomy
(canonical term → tight definition → `_Avoid_` aliases). In upstream Matt
Pocock skills that anatomy lives inside `CONTEXT.md` under `## Language`. In
**this** stack the glossary is **split out** into `LANGUAGE.md` so `CONTEXT.md`
stays orientation-only.

**Canonical exemplar:** `ai-browser-bridge/LANGUAGE.md`.

## Structure

```md
# LANGUAGE.md — {Project}

The human↔agent glossary: names only. Use these exact terms in code, comments,
commits, and docs; avoid the listed aliases. Orientation lives in `CONTEXT.md`.

## Terms

**Order**
A customer's request to purchase one or more items.
_Avoid_: Purchase, transaction.

**Invoice**
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request.

**Customer**
A person or organization that places orders.
_Avoid_: Client, buyer, account.
```

### Swaps table

`code-standard check` reads a `## Swaps` section and reports every declared name or file name that uses an avoided word, so one thing has one name in code. Put it last in the file. The header is exact:

```md
## Swaps

| Avoid in code | Use   |
| ------------- | ----- |
| userOwner     | owner |
| ownerUser     | owner |
```

Each row is two different names, and the use name must not contain the avoid name (`language-swaps-valid` checks this). Names are split into lowercase words, so `userOwnerId` and `user-owner-card` both match `userOwner`; a trailing `s` plural matches too. A missing section or an empty table means no swaps. Propose rows from the `nameWords` list of `code-standard check --json-output <file>`, where one thing has several names, and add only the ones the user approves.

### Optional area groups

When natural clusters exist, keep the same term block shape and introduce
sibling `##` section headings (not tables, not bullet lists):

```md
# LANGUAGE.md — {Project}

The human↔agent glossary: names only. Use these exact terms in code, comments,
commits, and docs; avoid the listed aliases. Orientation lives in `CONTEXT.md`.

## Catalog authoring

**Authoring Sheet**
The single spreadsheet that is the content source of truth.
_Avoid_: catalog file, Google sheet (alone).

## Practice

**Session Recipe**
Mood + duration keyed config the Motion Engine loads for a Practice Session.
_Avoid_: workout plan, template (for this concept).
```

A flat `## Terms` section is preferred when everything is one cohesive area.

## Term block anatomy (required)

Every term is three lines of shape (definition may wrap):

1. **`**Term**` on its own line** — Title Case or the exact code-facing spelling.
2. **Definition** — what it **is**, not a how-to. Prefer one or two tight sentences.
3. **`_Avoid_:`** — optional but preferred whenever synonyms exist. Comma-separated
   aliases and short “do not treat X as Y” notes.

```md
**Bridge**
The running tool that connects one terminal session to one — or several at once —
provider Conversations.
_Avoid_: browser instance, bot.
```

## Forbidden shapes

Do **not** emit any of these (historical drift; convert on sight):

| Forbidden | Why |
| --- | --- |
| Markdown tables for terms (`\| Term \| Definition \| Avoid \|`) | Harder for agents to extend; inconsistent column names. The `## Swaps` table is the one allowed table |
| Bullet glossaries (`- **Term** — def`) | Collapses term / definition / avoid into one line |
| Colon-on-bold (`**Term**:`) | Matt Pocock's *in-CONTEXT* colon form; we use bold-on-own-line |
| `_Avoid:_` (colon inside italics) | Use `_Avoid_:` (underscore-close, then colon) |
| Inline “Use: / Avoid:” dual lines | Fold Use into the definition; aliases go under `_Avoid_:` |
| Putting the glossary in `CONTEXT.md` | In this stack `CONTEXT.md` is orientation, not names |

## Rules

- **Names only.** No implementation walkthroughs, no roadmap, no long decision rationale.
- **Be opinionated.** Pick one canonical term; list rivals under `_Avoid_:`.
- **Project-specific only.** General programming words (timeout, retry, middleware)
  do not belong unless this project redefines them.
- **Group when natural.** Flat `## Terms` otherwise.
- **Create lazily.** Only write `LANGUAGE.md` when the first real domain term is
  resolved. Seed from code and existing docs; do not invent filler terms.
- **Keep `CONTEXT.md` free of glossary blocks.** If a term crystallises during
  grilling, append it here — never as a `## Language` section inside `CONTEXT.md`.

## Who writes this file

| Skill | Role |
| --- | --- |
| `code-style` | Create from this format when missing and the code or docs give a real domain term; write the approved `## Swaps` rows; report structure drift (do not invent terms without evidence) |
| `question-my-plan` / domain-modeling moments | **Owner of term content** — when a term is resolved, update `LANGUAGE.md` inline using this format |
| `explain-my-stack` | Leave alone unless a genuine *domain* term surfaces (tech teaching stays in chat) |

## Single vs multi-context repos

Most repos: one root `LANGUAGE.md`.

Multi-context repos (see `CONTEXT-MAP.md` / multiple `CONTEXT.md` files): still
prefer **one root `LANGUAGE.md`** with `##` sections per bounded context, and a
short note at the top that some words mean different things per context. Only
split into per-context language files if the vocabularies are large and
non-overlapping — then link them from the root file.
