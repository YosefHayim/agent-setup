# CONTEXT.md — image-to-code domain

Project-specific vocabulary and workflow contract for the image-to-code skill. Technical tool definitions live in [`TECH-GLOSSARY.md`](TECH-GLOSSARY.md).

## What this is

**image-to-code** turns a PNG (illustration, logo, UI mockup) into code that matches the original **1:1** — SVG, HTML/CSS, Tailwind, React, or whatever stack the target repo uses. Success is measured, not eyeballed.

## Ground rule

**The diff ratio is the source of truth.** Never claim "done" or "1:1" without running `pixel-diff` and reporting the mismatch ratio. If Playwright is unavailable, say the match is eyeballed.

## Workflow contract

1. **Intake** — confirm static vs animated, fidelity bar, living enhancements, reduced-motion before building.
2. **Frame** — build at the target PNG's exact pixel dimensions.
3. **Decompose** — ordered regions; mark raster vs reproducible-in-code; plan the rig before tracing animated parts.
4. **Reuse or build** — search SVG libraries first; trace/hand-build only the gap.
5. **Build one region** — largest/structural first; layout → typography → color → effects.
6. **Measure** — run diff; read ratio + hotspot grid.
7. **Refine** — fix the single biggest hotspot; one change per iteration.
8. **Optimize + animate last** — SVGO after static match; motion after rig crux test passes.

Converge until `ratio < 0.1%` or improvements stall — then report the number honestly.

## Domain vocabulary

Use these terms consistently in issues, refactors, test names, and agent output:

| Term | Meaning |
|------|---------|
| **diff ratio** | Fraction of pixels that differ between target PNG and rendered screenshot |
| **hotspot** | A grid cell where mismatches cluster — fix the top hotspot first |
| **region** | A decomposed slice of the design (background, figure, badge, text block) |
| **raster vs reproducible** | Export/slice vs build in CSS/SVG/code |
| **rig** | Skeleton of named, joint-pivoted, parented parts planned before geometry |
| **pivot** | Transform origin at the joint — not the bounding-box center |
| **slice** | Cut a moving part out of a trace at a joint |
| **overlap** | A cover layer that hides the seam when a part rotates |
| **living background** | Motion layered on top of the 1:1 still (aurora, drift) — rests at opacity 0 so rest diff stays valid |
| **act-then-hold** | Animation gesture completes early in the cycle, then holds (natural greeting, not perpetual wiggle) |
| **fidelity bar** | Strict 1:1 (diff is hard gate) vs inspired-by (diff is loose guide) |
| **crux test** | Seek each moving part to rotation extremes; joint must not gap or ghost |

## Decisions

Architectural decisions for this skill go in the PR description of the change that makes them. Read the related PRs before contradicting past choices.
