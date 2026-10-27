---
name: make-code-readable
description: Use when you want code that is easier to read — clearer names, order, files, and functions. It shows before and after, and changes code only after you approve. Say "make this readable", "no nested ifs", "no ternaries", "nested ternary", "avoid let", "proper naming", "rename for clarity", or "clean this up". To remove extra layers, use simplify-code. For a whole repo, use restructure-repo.
---

# Make code readable

Make code feel deliberate and easy to understand quickly. The default mode is review-first: show the user the current pipeline, the proposed style, and concrete before/after examples before changing files.

Do not apply edits until the user approves the style, unless the user explicitly says to apply immediately.

> **Companion skill:** `make-code-readable` makes code *readable* (naming, ordering, splitting for clarity); `simplify-code` makes it *lean* (removing over-engineering — pass-through wrappers, `??` confetti, nested ternaries, grab-bag returns, and over-nested folders/packages). If the real problem is too much abstraction or structure rather than unclear naming, use `simplify-code`. When both apply, simplify-code removes the extra code first, then make-code-readable names what remains.

## Core Contract

Optimize for a developer understanding the important path in about 5 seconds:

```txt
entrypoint -> data/load step -> transformation -> side effect -> UI/output
```

Good readability work may rename symbols, reorder imports, move files, split or inline functions, extract React hooks, remove pointless hooks, rename folders, flatten render branches, or simplify module boundaries. The measure is readability of the pipeline, not blindly adding abstractions.

## Style source (read first)

Before proposing any style, read the code-standard README (`node_modules/code-standard/README.md`) and the `AGENTS.md` section `## Exceptions to code-standard`. When `code-standard` is installed, they are the **authoritative target style** for this repo — the generic doctrine below only fills the gaps they don't cover, and where the two conflict, **the standard plus the repo's exceptions win**. Run `pnpm exec code-standard check` and read the `findings.md` path it prints; code that breaks a rule is a primary readability target, called out first. Not installed: offer `code-style` (Adopt).

You **enforce** the guide; you never edit it. If one of its rules looks wrong or is fighting readability, flag it in the review and point the user to `code-style` to evolve the guide — don't silently deviate from it. If neither file exists, proceed on the generic doctrine below exactly as before.

## Review First

1. Identify the target files from the user's paths, `git diff`, recent session edits, or the nearest entrypoint.
2. Read the relevant files before judging them.
3. Map the current pipeline with concrete file and symbol names.
4. Find comprehension blockers:
   - names that hide behavior or return shape
   - functions/components/hooks doing several jobs
   - imports, folders, or file names that hide ownership
   - data shaping mixed with side effects
   - React render logic with nested branches or noisy derived values
   - too many tiny helpers that obscure the main flow
5. Show 2-4 before/after examples representing the proposed style.
6. Ask for approval before editing.

Use [references/review-and-apply.md](references/review-and-apply.md) for the exact report and edit rules.

## Review Output Shape

Keep the review compact and concrete:

```txt
Current 5-second map
FileA -> vagueFn -> useThing -> handler -> render

Proposed map
ThingPage -> useThingPageData -> buildThingViewModel -> ThingContent
```

Then include:

- `Main readability issue:` one sentence
- `Before/after examples:` short code snippets, not a giant diff
- `Risk:` API/import/test impact
- `Apply?` ask whether to apply this style now

## Apply After Approval

When approved:

1. Edit only the approved scope.
2. Preserve behavior unless the user explicitly approved behavior changes.
3. Prefer the smallest change that makes the pipeline clearer.
4. Rename public exports, routes, folders, or shared APIs only after mapping their usages.
5. Run the relevant typecheck/test/lint gate when available.
6. Summarize the actual before -> after pipeline.

## Examples

Use [references/examples.md](references/examples.md) when the user wants explicit examples or when the review would otherwise be too abstract.

## Stop Conditions

Stop and ask before editing when:

- the cleanup requires a behavioral decision
- a rename crosses public API or package boundaries
- the real fix is architectural, not readability cleanup
- tests are missing and the change is broad
- the current code is already clear enough
