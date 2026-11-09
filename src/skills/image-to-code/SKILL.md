---
name: image-to-code
description: Use when you have an image (screenshot, mockup, or design) and want code that looks exactly the same — SVG, HTML/CSS, or animation. It renders, compares pixels, and fixes until it matches. Say "turn this image into code", "pixel-perfect", or "PNG to SVG".
---

# Image to code

Reproduce a PNG (illustration, logo, UI screen, or full mockup) as code that matches the original **1:1**. Go slowly: build one region at a time and **re-measure after every change**. The agent reaches pixel-perfect the same way a designer did with a PerfectPixel overlay — except the overlay is a **measured pixel diff**, not a human eye.

## Ground rule

**The diff score is the source of truth.** Never call something "done" or "1:1" from looking at it. Render it, screenshot it, diff it against the target PNG with `scripts/src/bin/pixel-diff.ts`, and drive the mismatch ratio toward zero. If you cannot measure it, say so plainly. Use a second agent or browser model as a **visual judge** for detailed feedback on what to change, but never let that replace the measured score.

## The loop

Step 0 runs once at the start; repeat steps 4–6 until converged.

0. **Intake — align on intent before measuring.** A PNG is one frozen frame; what the user wants in *motion* and *fidelity* is not in the pixels, so ask (a short `AskUserQuestion` is ideal). Cover: static reproduction or animated? if animated, which parts move and how big a gesture (subtle idle vs hero wave)? strict 1:1, or "inspired-by / make it prettier"? reduced-motion fallback? And **proactively suggest the life a static PNG cannot depict** — most often a living/animated background (drifting aurora, floating blobs) — and confirm the vibe before building. Never infer animation scope from a still. → `reference/decompose.md` (§0)
1. **Frame** — read target dimensions with `scripts/src/bin/inspect-png.ts`. The render viewport is the target's pixel size.
2. **Decompose** — split the image into ordered regions; mark each *raster* (export/slice) vs *reproducible in code* (CSS/SVG). Extract exact specs (color, type, spacing). **If anything will animate, plan the rig now** — decompose into the skeleton of named, joint-pivoted, parented parts before acquiring geometry. → `reference/decompose.md`, `reference/rigging.md`
3. **Reuse or build** — search existing SVG libraries first and customize; trace or hand-build only the gap. For animated parts, build to rig (**reuse > hand-build > per-part masked trace > never one flat trace**). → `reference/svg-illustration.md`, `reference/rigging.md`
4. **Build one region** — structural/largest first. Match the target repo's stack; if none, vanilla HTML/CSS/SVG. Order within a region: layout → typography → color → effects.
5. **Measure + judge** — run the diff. Read the ratio and the **hotspot grid** (where the biggest differences are). When the diff stalls or the mismatch is easier to describe visually than numerically, ask a separate visual judge to compare target/current/diff and return concrete deltas. → `reference/verification.md`
6. **Refine** — fix the single biggest hotspot or judge-identified delta, re-run, and ask again only after measuring. One change per iteration so each diff is attributable. Continue until `ratio < 0.1%`, the judge finds no meaningful visual delta, or the developer approves the match — then report the final number.
7. **Optimize + animate last** — SVGO the vectors (`scripts/svgo.config.mjs`); add animation only after the static match holds and (for figures) the rig passes its crux test. → `reference/animation.md`

## Stack detection (step 4)

Detect before writing code, in order: (1) the target repo's framework/styling (`package.json`, existing components, Tailwind / CSS modules / styled-components) → match it; (2) no repo or greenfield → framework-agnostic **vanilla HTML + CSS + inline SVG**. Add a library (GSAP, Lottie, anime.js) only for a concrete need (complex morph, After-Effects export) and note why near the import.

## Reuse before building (step 3)

Always check for an existing vector before tracing: SVGRepo, unDraw, Heroicons, Feather, Phosphor, Lucide, Iconify, Noun Project. Recolor/resize to match. Trace (potrace / AutoTrace / Inkscape) only what you cannot find, then simplify nodes. Details + sources in `reference/svg-illustration.md`.

## First-time setup (verification harness)

The diff loop needs Node. From the skill's `scripts/`:

```
npm install
npx playwright install chromium
```

Then, per iteration (from `scripts/`):

```
npx tsx src/bin/pixel-diff.ts --target design.png --input build/index.html
```

Or: `npm run diff -- --target design.png --input build/index.html`

Optional visual judge loop:

```
bridge ask "Compare design.png, current.png, and diff.png. List the exact visual changes needed next; do not rewrite code." --provider chatgpt --attach design.png current.png diff.png --json
```

Use `bridge --help` / `bridge ask --help` for the installed syntax. If bridge is unavailable, compare the images yourself and say the judge step was skipped. `current.png` can be a browser screenshot of the rendered build at the target dimensions.

If Node/Playwright is unavailable, use the manual overlay method in `reference/verification.md` and state the match is eyeballed, not measured.

## Convergence checklist

- [ ] Confirmed intent first (static vs animated, fidelity bar, optional living enhancements) — not inferred from the still
- [ ] Viewport set to the target's exact pixel dimensions
- [ ] Fonts loaded and animations frozen before each screenshot
- [ ] Fixed the biggest hotspot, not random tweaks
- [ ] One change per measured iteration
- [ ] When using a judge, fed it target/current/diff and turned only one concrete delta into the next edit
- [ ] Reported the final mismatch ratio honestly (no unmeasured 1:1 claims)

## Files

- `reference/decompose.md` — read the design, raster-vs-code triage, spec extraction, rig planning
- `reference/svg-illustration.md` — reuse sources, tracing, hand-building, SVGO
- `reference/rigging.md` — structure a figure to animate: slice at joints, pivot at joint, parent, overlap (do this at build time)
- `reference/animation.md` — motion that reads as alive: easing, act-then-hold, timing cheat-sheet, reduced motion, line-draw recipe
- `reference/verification.md` — the diff loop, thresholds, scale, manual fallback
- `scripts/src/bin/pixel-diff.ts` — render (Playwright) + pixel diff (pixelmatch) → ratio + hotspots
- `scripts/src/bin/inspect-png.ts` — target dimensions + color sampling / palette
- `scripts/src/bin/frames.ts` — contact sheet of animation frames by timeline-seeking (verify motion poses)
- `scripts/svgo.config.mjs` — safe SVGO config (keeps viewBox + IDs)
- `README.md` — setup, script catalog, and canonical iteration example
- `CONTEXT.md` / `TECH-GLOSSARY.md` — domain vocabulary and technical glossary
