# Review And Apply Rules

## Read-Only Review Report

Use this exact order:

1. `Current 5-second map`
2. `What blocks fast understanding`
3. `Proposed 5-second map`
4. `Before/after examples`
5. `Risk and blast radius`
6. `Recommended apply scope`
7. `Question: Apply this style now?`

Keep the report grounded in inspected files. Do not invent file names, hooks, routes, or folders.

## What Counts As A Readability Improvement

Prefer changes that make the main flow easier to scan:

- rename vague functions to verb phrases
- rename booleans to `is`, `has`, `can`, or `should`
- rename files/folders to match ownership and exported concepts
- group imports by platform/package/local code if the repo has no stricter convention
- inline helpers that hide one line of obvious logic
- extract helpers when a function has multiple real stages
- extract React hooks for stateful reusable behavior, not for one-line derived values
- extract pure React helpers for filtering, labels, grouping, or view-model shaping
- flatten nested conditionals and render branches with early returns
- separate data loading, transformation, mutation, and rendering
- remove comments that only explain confusing code after simplifying that code; keep a one-line comment that says why odd code is there

## Abstraction Rule

More functions is not automatically better.

Extract when the new name exposes a real step in the pipeline:

```txt
load -> validate -> createOrderSummary -> show
```

Inline when the helper only forces the reader to jump:

```txt
isOrderVisible(order) -> order.status === "visible"
```

## React Rule

For React, choose the shape by ownership:

- component owns layout and render branches
- hook owns state, effects, subscriptions, queries, and mutations
- pure helper owns sorting, filtering, grouping, labels, and view-model construction
- child component owns a distinct visual or interaction concern

Do not move simple JSX event handlers into hooks unless they are reused, stateful, or hide a meaningful workflow.

## Rename Safety

Before renaming exported symbols, files, folders, routes, database fields, env vars, or public APIs:

1. search usages with `rg`
2. identify package or runtime boundaries
3. mention the blast radius in the review
4. edit only after approval

Local variables and private helpers can be renamed during the approved cleanup pass when tests/typecheck cover the area.

## Verification

After edits, run the narrowest meaningful gate available:

- TypeScript: typecheck for the touched package/app
- React UI: typecheck plus focused tests if present
- backend route/service: relevant unit/integration tests
- file/folder rename: typecheck or build that catches import paths

If no gate exists, say that clearly and summarize what was manually checked.
